#!/usr/bin/env node
//  MCP server for the App Store Connect API (TestFlight side), for
//  Legacy M Online (com.legacym.online). The Google Play twin is ../play-mcp.
//
//  Auth: the team API key the signing setup already uses, in
//  MOBILE/native/.appstore/ (gitignored): AuthKey_<KEYID>.p8 and `config`
//  with KEY_ID, ISSUER_ID, TEAM_ID. Or ASC_DIR pointing at another folder.
//  The key never leaves this process; no secret is ever returned by a tool.
//
//  What the API cannot do: create the app record (App Store Connect only),
//  and upload a build (ios-testflight.yml does that with altool).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..', '..');
const DIR = process.env.ASC_DIR || path.join(MOBILE, 'native', '.appstore');
const BUNDLE = process.env.ASC_BUNDLE || 'com.legacym.online';
const API = 'https://api.appstoreconnect.apple.com/v1';

/* ---------------------------------------------------------------- auth */

function config() {
    const f = path.join(DIR, 'config');
    if (!fs.existsSync(f)) throw new Error(`no ${f}: put KEY_ID=, ISSUER_ID=, TEAM_ID= there (README.md)`);
    const cfg = {};
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    for (const k of ['KEY_ID', 'ISSUER_ID']) if (!cfg[k]) throw new Error(`config is missing ${k}`);
    let p8 = path.join(DIR, `AuthKey_${cfg.KEY_ID}.p8`);
    if (!fs.existsSync(p8)) {
        const found = fs.readdirSync(DIR).filter(n => n.endsWith('.p8'));
        if (found.length !== 1) throw new Error(`put AuthKey_${cfg.KEY_ID}.p8 in ${DIR}`);
        p8 = path.join(DIR, found[0]);
    }
    cfg.P8 = p8;
    return cfg;
}

let _tok = null, _tokExp = 0;
function token() {
    const now = Math.floor(Date.now() / 1000);
    if (_tok && now < _tokExp - 60) return _tok;
    const cfg = config();
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const msg = b64({ alg: 'ES256', kid: cfg.KEY_ID, typ: 'JWT' }) + '.' +
        b64({ iss: cfg.ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' });
    const sig = crypto.sign('sha256', Buffer.from(msg), {
        key: fs.readFileSync(cfg.P8, 'utf8'), dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    _tok = msg + '.' + sig; _tokExp = now + 1200;
    return _tok;
}

async function call(method, p, body) {
    const r = await fetch(p.startsWith('http') ? p : API + p, {
        method,
        headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const json = text ? JSON.parse(text) : {};
    if (!r.ok) {
        const errs = (json.errors || []).map(e => `${e.status} ${e.code}: ${e.detail || e.title}`).join('\n');
        throw new Error(`${method} ${p} -> ${r.status}\n${errs || text.slice(0, 800)}`);
    }
    return json;
}
const get = p => call('GET', p);

let _app = null;
async function appId() {
    if (_app) return _app;
    const r = await get(`/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`);
    if (!r.data?.length) throw new Error(`no app with bundle id ${BUNDLE}; create it in App Store Connect first`);
    return (_app = r.data[0].id);
}

async function buildId(version) {
    const app = await appId();
    const q = version
        ? `/builds?filter[app]=${app}&filter[version]=${encodeURIComponent(version)}&limit=1`
        : `/builds?filter[app]=${app}&sort=-uploadedDate&limit=1`;
    const r = await get(q);
    if (!r.data?.length) throw new Error(version ? `no build ${version}` : 'no builds uploaded yet');
    return r.data[0];
}

async function groupByName(name) {
    const r = await get(`/apps/${await appId()}/betaGroups?limit=200`);
    const g = r.data.find(x => x.attributes.name.toLowerCase() === name.toLowerCase());
    if (!g) throw new Error(`no group "${name}"; groups: ${r.data.map(x => x.attributes.name).join(', ') || 'none'}`);
    return g;
}

function groupView(g) {
    const a = g.attributes;
    return {
        name: a.name, id: g.id, internal: a.isInternalGroup,
        publicLinkEnabled: a.publicLinkEnabled ?? null, publicLink: a.publicLink ?? null,
        publicLinkLimit: a.publicLinkLimit ?? null, feedbackEnabled: a.feedbackEnabled ?? null,
    };
}

/* ---------------------------------------------------------------- tools */

function ok(obj) {
    return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}
function tool(server, name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
        try { return ok(await handler(args)); }
        catch (e) { return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] }; }
    });
}

const server = new McpServer({ name: 'app-store-connect', version: '1.0.0' });
const buildArg = z.string().optional().describe('build number (CFBundleVersion, e.g. "273"); default the newest upload');
const localeArg = z.string().optional().describe('TestFlight locale, default "th"');

tool(server, 'asc_status',
    'Check the key works and show the app: newest builds (processing, internal/external beta state, beta review state, expiry), beta groups (public link, tester count, builds), Test Information and which review-detail fields are still empty.',
    {},
    async () => {
        const app = await appId();
        const [builds, groups, locs, rd] = await Promise.all([
            get(`/builds?filter[app]=${app}&sort=-uploadedDate&limit=5&include=buildBetaDetail`),
            get(`/apps/${app}/betaGroups?limit=200`),
            get(`/apps/${app}/betaAppLocalizations`),
            get(`/apps/${app}/betaAppReviewDetail`),
        ]);
        const det = Object.fromEntries((builds.included || []).map(i => [i.id, i.attributes]));
        const groupsOut = [];
        for (const g of groups.data) {
            const [t, b] = await Promise.all([
                get(`/betaGroups/${g.id}/betaTesters?limit=200`),
                get(`/betaGroups/${g.id}/builds?limit=20`),
            ]);
            groupsOut.push({ ...groupView(g), testers: t.data.length, builds: b.data.map(x => x.attributes.version) });
        }
        const buildsOut = [];
        for (const b of builds.data) {
            const d = det[b.relationships?.buildBetaDetail?.data?.id] || {};
            let review = null;
            try {
                const s = await get(`/builds/${b.id}/betaAppReviewSubmission`);
                review = s.data?.attributes?.betaReviewState ?? null;
            } catch { /* none yet */ }
            buildsOut.push({
                version: b.attributes.version, processing: b.attributes.processingState,
                uploaded: b.attributes.uploadedDate, expires: b.attributes.expirationDate, expired: b.attributes.expired,
                internal: d.internalBuildState, external: d.externalBuildState, betaReview: review,
            });
        }
        const r = rd.data.attributes;
        const required = ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'];
        return {
            bundleId: BUNDLE, appId: app,
            builds: buildsOut,
            groups: groupsOut,
            testInformation: locs.data.map(l => ({
                locale: l.attributes.locale,
                feedbackEmail: l.attributes.feedbackEmail ? 'set' : 'EMPTY',
                description: l.attributes.description ? `${l.attributes.description.length} chars` : 'EMPTY',
                privacyPolicyUrl: l.attributes.privacyPolicyUrl || null,
            })),
            reviewDetail: {
                missing: required.filter(k => !r[k]),
                demoAccountRequired: r.demoAccountRequired,
                demoAccount: r.demoAccountName ? 'set' : 'EMPTY',
                notes: r.notes ? `${r.notes.length} chars` : 'EMPTY',
            },
        };
    });

tool(server, 'asc_set_test_info',
    'Set the TestFlight Test Information for one locale: beta app description, feedback email, marketing and privacy policy URLs. Creates the locale if missing. Omitted fields stay as they are.',
    {
        locale: localeArg,
        description: z.string().optional(),
        feedbackEmail: z.string().optional(),
        marketingUrl: z.string().optional(),
        privacyPolicyUrl: z.string().optional(),
    },
    async ({ locale = 'th', ...attrs }) => {
        const app = await appId();
        const a = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
        const locs = (await get(`/apps/${app}/betaAppLocalizations`)).data;
        const l = locs.find(x => x.attributes.locale === locale);
        if (l) {
            await call('PATCH', `/betaAppLocalizations/${l.id}`, { data: { type: 'betaAppLocalizations', id: l.id, attributes: a } });
            return { locale, updated: Object.keys(a) };
        }
        await call('POST', '/betaAppLocalizations', {
            data: { type: 'betaAppLocalizations', attributes: { locale, ...a }, relationships: { app: { data: { type: 'apps', id: app } } } },
        });
        return { locale, created: Object.keys(a) };
    });

tool(server, 'asc_set_review_details',
    'Set Beta App Review Information: contact name/phone/email, sign-in (demo) account, review notes. Apple requires the four contact fields to be present in the same save, so fields already stored are re-sent automatically. Passwords are never returned.',
    {
        contactFirstName: z.string().optional(),
        contactLastName: z.string().optional(),
        contactPhone: z.string().optional().describe('with country code, e.g. +66812345678'),
        contactEmail: z.string().optional(),
        demoAccountRequired: z.boolean().optional(),
        demoAccountName: z.string().optional(),
        demoAccountPassword: z.string().optional(),
        notes: z.string().optional(),
    },
    async (attrs) => {
        const rd = (await get(`/apps/${await appId()}/betaAppReviewDetail`)).data;
        const cur = rd.attributes;
        const a = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
        for (const k of ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'])
            if (a[k] === undefined && cur[k]) a[k] = cur[k];
        await call('PATCH', `/betaAppReviewDetails/${rd.id}`, { data: { type: 'betaAppReviewDetails', id: rd.id, attributes: a } });
        return { updated: Object.keys(a).filter(k => k in attrs) };
    });

tool(server, 'asc_set_what_to_test',
    'Set a build\'s "What to Test" text for one locale.',
    { build: buildArg, locale: localeArg, text: z.string() },
    async ({ build, locale = 'th', text }) => {
        const b = await buildId(build);
        const ls = (await get(`/builds/${b.id}/betaBuildLocalizations`)).data;
        const l = ls.find(x => x.attributes.locale === locale);
        if (l) await call('PATCH', `/betaBuildLocalizations/${l.id}`, { data: { type: 'betaBuildLocalizations', id: l.id, attributes: { whatsNew: text } } });
        else await call('POST', '/betaBuildLocalizations', {
            data: { type: 'betaBuildLocalizations', attributes: { locale, whatsNew: text }, relationships: { build: { data: { type: 'builds', id: b.id } } } },
        });
        return { build: b.attributes.version, locale, set: true };
    });

tool(server, 'asc_create_group',
    'Create a beta group. External by default (needs Beta App Review per build); internal groups only take App Store Connect users.',
    { name: z.string(), internal: z.boolean().optional() },
    async ({ name, internal = false }) => {
        const r = await call('POST', '/betaGroups', {
            data: { type: 'betaGroups', attributes: { name, isInternalGroup: internal }, relationships: { app: { data: { type: 'apps', id: await appId() } } } },
        });
        return groupView(r.data);
    });

tool(server, 'asc_add_build_to_group',
    'Give a beta group a build. For an external group the build must also pass Beta App Review (asc_submit_review) before testers get it.',
    { group: z.string().describe('group name'), build: buildArg },
    async ({ group, build }) => {
        const [g, b] = await Promise.all([groupByName(group), buildId(build)]);
        await call('POST', `/betaGroups/${g.id}/relationships/builds`, { data: [{ type: 'builds', id: b.id }] });
        return { group: g.attributes.name, build: b.attributes.version, added: true };
    });

tool(server, 'asc_submit_review',
    'Submit a build for Beta App Review (external testing). Test Information and review contact must be filled first; asc_status shows what is missing.',
    { build: buildArg },
    async ({ build }) => {
        const b = await buildId(build);
        const r = await call('POST', '/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: b.id } } } } });
        return { build: b.attributes.version, betaReviewState: r.data.attributes.betaReviewState, submitted: r.data.attributes.submittedDate };
    });

tool(server, 'asc_public_link',
    'Turn an external group\'s public TestFlight link on or off, optionally with a tester limit (1-10000), and return the link.',
    { group: z.string(), enabled: z.boolean(), limit: z.number().int().min(1).max(10000).optional(), feedbackEnabled: z.boolean().optional() },
    async ({ group, enabled, limit, feedbackEnabled }) => {
        const g = await groupByName(group);
        const attributes = { publicLinkEnabled: enabled };
        if (limit !== undefined) { attributes.publicLinkLimitEnabled = true; attributes.publicLinkLimit = limit; }
        if (feedbackEnabled !== undefined) attributes.feedbackEnabled = feedbackEnabled;
        const r = await call('PATCH', `/betaGroups/${g.id}`, { data: { type: 'betaGroups', id: g.id, attributes } });
        return groupView(r.data);
    });

tool(server, 'asc_testers',
    'List the testers of a group, or add / remove one by email. Adding to an external group sends the TestFlight invite email. Emails are masked in the list.',
    { group: z.string(), action: z.enum(['list', 'add', 'remove']).optional(), email: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional() },
    async ({ group, action = 'list', email, firstName, lastName }) => {
        const g = await groupByName(group);
        const mask = e => e ? e.replace(/^(.).*?(@.*)$/, '$1***$2') : null;
        if (action === 'list') {
            const t = await get(`/betaGroups/${g.id}/betaTesters?limit=200`);
            return t.data.map(x => ({ email: mask(x.attributes.email), state: x.attributes.state, inviteType: x.attributes.inviteType }));
        }
        if (!email) throw new Error('email is required');
        if (action === 'add') {
            const attributes = { email };
            if (firstName) attributes.firstName = firstName;
            if (lastName) attributes.lastName = lastName;
            await call('POST', '/betaTesters', { data: { type: 'betaTesters', attributes, relationships: { betaGroups: { data: [{ type: 'betaGroups', id: g.id }] } } } });
            return { added: mask(email), group: g.attributes.name };
        }
        const f = await get(`/betaTesters?filter[email]=${encodeURIComponent(email)}`);
        if (!f.data.length) throw new Error('no such tester');
        await call('DELETE', `/betaGroups/${g.id}/relationships/betaTesters`, { data: [{ type: 'betaTesters', id: f.data[0].id }] });
        return { removed: mask(email), group: g.attributes.name };
    });

tool(server, 'asc_feedback',
    'Read recent TestFlight feedback: screenshot feedback (comment, device, OS, build) and crash feedback.',
    { limit: z.number().int().min(1).max(50).optional() },
    async ({ limit = 20 }) => {
        const app = await appId();
        const pick = async (kind) => {
            try {
                const r = await get(`/apps/${app}/${kind}?limit=${limit}`);
                return r.data.map(x => {
                    const a = x.attributes;
                    return { created: a.createdDate, comment: a.comment, device: a.deviceModel, os: a.osVersion, build: a.buildBundleVersion ?? null };
                });
            } catch (e) { return `unavailable: ${e.message.split('\n')[0]}`; }
        };
        return { screenshots: await pick('betaFeedbackScreenshotSubmissions'), crashes: await pick('betaFeedbackCrashSubmissions') };
    });

await server.connect(new StdioServerTransport());
