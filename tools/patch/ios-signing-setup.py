"""One-time TestFlight signing setup, run on Windows (no Mac needed).

Talks to the App Store Connect API with the team key the user created
(Users and Access > Integrations > App Store Connect API, Admin), and:

  1. registers the bundle id com.legacym.online if it is not there yet
  2. makes an Apple Distribution certificate from a key generated here
  3. makes an App Store provisioning profile for that id and certificate
  4. stores everything ios-testflight.yml needs as GitHub secrets

Input, all in MOBILE/native/.appstore/ (gitignored):
    AuthKey_<KEYID>.p8     the downloaded key
    config                 KEY_ID=..., ISSUER_ID=..., TEAM_ID=...

Output, same folder: dist.p12, dist.pass, profile.mobileprovision.
Nothing secret is ever printed.

    python ios-signing-setup.py --check    only proves the key works
    python ios-signing-setup.py            full setup
"""
import base64, datetime, glob, json, os, secrets, subprocess, sys, time
import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

BUNDLE_ID = 'com.legacym.online'
APP_NAME = 'Legacy M Online'
HERE = os.path.dirname(os.path.abspath(__file__))
MOB = os.path.abspath(os.path.join(HERE, '..', '..'))
DIR = os.path.join(MOB, 'native', '.appstore')
API = 'https://api.appstoreconnect.apple.com/v1'


def load_config():
    cfg = {}
    with open(os.path.join(DIR, 'config'), encoding='utf-8') as f:
        for line in f:
            if '=' in line:
                k, v = line.strip().split('=', 1)
                cfg[k.strip()] = v.strip()
    for k in ('KEY_ID', 'ISSUER_ID', 'TEAM_ID'):
        if not cfg.get(k):
            sys.exit('config is missing ' + k)
    p8 = os.path.join(DIR, 'AuthKey_%s.p8' % cfg['KEY_ID'])
    if not os.path.exists(p8):
        found = glob.glob(os.path.join(DIR, '*.p8'))
        if len(found) != 1:
            sys.exit('put AuthKey_%s.p8 in %s' % (cfg['KEY_ID'], DIR))
        p8 = found[0]
    cfg['P8'] = p8
    return cfg


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(cfg):
    """ES256 JWT, 20 minutes, as the App Store Connect API wants it."""
    key = serialization.load_pem_private_key(open(cfg['P8'], 'rb').read(), None)
    head = {'alg': 'ES256', 'kid': cfg['KEY_ID'], 'typ': 'JWT'}
    now = int(time.time())
    body = {'iss': cfg['ISSUER_ID'], 'iat': now, 'exp': now + 1200, 'aud': 'appstoreconnect-v1'}
    msg = b64url(json.dumps(head).encode()) + '.' + b64url(json.dumps(body).encode())
    der = key.sign(msg.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return msg + '.' + b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))


def call(cfg, method, path, body=None):
    r = requests.request(method, API + path, json=body, timeout=60,
                         headers={'Authorization': 'Bearer ' + token(cfg)})
    if r.status_code >= 300:
        #  Apple's error text names the problem (role, duplicate, limit); it
        #  carries no secret.
        sys.exit('%s %s -> HTTP %d\n%s' % (method, path, r.status_code, r.text[:2000]))
    return r.json() if r.text else {}


def bundle_id(cfg):
    got = call(cfg, 'GET', '/bundleIds?filter[identifier]=' + BUNDLE_ID)['data']
    got = [b for b in got if b['attributes']['identifier'] == BUNDLE_ID]
    if got:
        print('bundle id', BUNDLE_ID, 'exists')
        return got[0]['id']
    made = call(cfg, 'POST', '/bundleIds', {'data': {'type': 'bundleIds', 'attributes': {
        'identifier': BUNDLE_ID, 'name': APP_NAME, 'platform': 'IOS'}}})
    print('bundle id', BUNDLE_ID, 'registered')
    return made['data']['id']


def certificate(cfg):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, APP_NAME)]))
           .sign(key, hashes.SHA256()))
    pem = csr.public_bytes(serialization.Encoding.PEM).decode()
    made = call(cfg, 'POST', '/certificates', {'data': {'type': 'certificates', 'attributes': {
        'certificateType': 'DISTRIBUTION', 'csrContent': pem}}})
    der = base64.b64decode(made['data']['attributes']['certificateContent'])
    cert = x509.load_der_x509_certificate(der)
    print('certificate made, expires', cert.not_valid_after_utc.date())
    #  3DES/SHA1 PKCS#12: macOS `security import` refuses the AES/PBES2 kind
    #  OpenSSL 3 writes by default.
    pw = secrets.token_urlsafe(24)
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
           .kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC)
           .hmac_hash(hashes.SHA1()).build(pw.encode()))
    p12 = pkcs12.serialize_key_and_certificates(APP_NAME.encode(), key, cert, None, enc)
    open(os.path.join(DIR, 'dist.p12'), 'wb').write(p12)
    open(os.path.join(DIR, 'dist.pass'), 'w').write(pw)
    return made['data']['id']


def profile(cfg, bid, cid):
    made = call(cfg, 'POST', '/profiles', {'data': {
        'type': 'profiles',
        'attributes': {'name': APP_NAME + ' App Store ' + datetime.date.today().isoformat(),
                       'profileType': 'IOS_APP_STORE'},
        'relationships': {
            'bundleId': {'data': {'type': 'bundleIds', 'id': bid}},
            'certificates': {'data': [{'type': 'certificates', 'id': cid}]}}}})
    open(os.path.join(DIR, 'profile.mobileprovision'), 'wb').write(
        base64.b64decode(made['data']['attributes']['profileContent']))
    print('profile made')


def secret(name, value):
    """gh secret set, value on stdin so it never touches a command line."""
    subprocess.run(['gh', 'secret', 'set', name], input=value.encode(), cwd=MOB,
                   check=True, stdout=subprocess.DEVNULL)
    print('  secret', name)


def main():
    cfg = load_config()
    if '--check' in sys.argv:
        apps = call(cfg, 'GET', '/apps?limit=50')['data']
        print('key works; apps on the account:',
              ', '.join('%s (%s)' % (a['attributes']['name'], a['attributes']['bundleId']) for a in apps) or 'none')
        return
    bid = bundle_id(cfg)
    cid = certificate(cfg)
    profile(cfg, bid, cid)
    rd = lambda n: open(os.path.join(DIR, n), 'rb').read()
    secret('ASC_KEY_ID', cfg['KEY_ID'])
    secret('ASC_ISSUER_ID', cfg['ISSUER_ID'])
    secret('IOS_TEAM_ID', cfg['TEAM_ID'])
    secret('ASC_KEY_P8', rd(os.path.basename(cfg['P8'])).decode())
    secret('IOS_DIST_P12', base64.b64encode(rd('dist.p12')).decode())
    secret('IOS_DIST_P12_PASS', rd('dist.pass').decode())
    secret('IOS_PROFILE', base64.b64encode(rd('profile.mobileprovision')).decode())
    print('done - run the "iOS TestFlight" workflow')


if __name__ == '__main__':
    main()
