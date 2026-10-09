#!/usr/bin/env node
//  MCP server for the Google Play Developer API (androidpublisher v3), for
//  Legacy M Online (com.legacym.online).
//
//  Auth: a Google Cloud service account whose JSON key sits at
//  MOBILE/native/.play/service-account.json (gitignored), or wherever
//  PLAY_KEY points. The service account must be invited in Play Console
//  (Users and permissions) with permission on this app. See README.md.
//
//  Every change goes through an "edit": open, change, commit. A tool that
//  changes something commits its own edit, so one call is one change in
//  Play Console; nothing is left half-done in an open edit.
//
//  What the API cannot do: create the app (Play Console only), and the very
//  first bundle of a new app is uploaded in Play Console by hand - that is
//  what fixes the package name to the app.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { google } from 'googleapis';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..', '..');
const KEY = process.env.PLAY_KEY || path.join(MOBILE, 'native', '.play', 'service-account.json');
const DEFAULT_PACKAGE = process.env.PLAY_PACKAGE || 'com.legacym.online';
const TRACKS = ['internal', 'alpha', 'beta', 'production'];

let _api = null;
function api() {
    if (_api) return _api;
    if (!fs.existsSync(KEY)) {
        throw new Error(`no service-account key at ${KEY}. Create one (README.md, "Setup") and save it there.`);
    }
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY,
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    _api = google.androidpublisher({ version: 'v3', auth, timeout: 15 * 60 * 1000 });
    return _api;
}

function ok(obj) {
    return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

//  Google's errors carry the useful part deep inside; surface it.
function fail(e) {
    const g = e?.response?.data?.error;
    const msg = g ? `${g.code} ${g.status || ''}: ${g.message}` : (e?.message || String(e));
    return { isError: true, content: [{ type: 'text', text: msg }] };
}

//  Run fn inside an edit. commit=false deletes the edit afterwards (reads).
async function withEdit(pkg, fn, { commit = false, changesNotSentForReview } = {}) {
    const ap = api();
    const { data: edit } = await ap.edits.insert({ packageName: pkg, requestBody: {} });
    const editId = edit.id;
    try {
        const result = await fn(ap, editId);
        if (commit) {
            const params = { packageName: pkg, editId };
            if (changesNotSentForReview !== undefined) params.changesNotSentForReview = changesNotSentForReview;
            const { data } = await ap.edits.commit(params);
            return { result, committed: data.id };
        }
        await ap.edits.delete({ packageName: pkg, editId }).catch(() => {});
        return { result };
    } catch (e) {
        await ap.edits.delete({ packageName: pkg, editId }).catch(() => {});
        throw e;
    }
}

function notesToList(notes) {
    if (!notes) return undefined;
    return Object.entries(notes).map(([language, text]) => ({ language, text }));
}

function tool(server, name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
        try { return ok(await handler(args)); } catch (e) { return fail(e); }
    });
}

const server = new McpServer({ name: 'google-play', version: '1.0.0' });
const pkgArg = z.string().optional().describe(`package name, default ${DEFAULT_PACKAGE}`);
const reviewArg = z.boolean().optional().describe(
    'set true only if Play rejects the commit asking for changesNotSentForReview (changes are then sent for review from Play Console by hand)');

/* ---------------------------------------------------------------- read */

tool(server, 'play_status',
    'Check the key works and show the app: details (default language, contact), every track with its releases (version codes, status, rollout), and the uploaded bundles.',
    { packageName: pkgArg },
    async ({ packageName = DEFAULT_PACKAGE }) => {
        const { result } = await withEdit(packageName, async (ap, editId) => {
            const [details, tracks, bundles] = await Promise.all([
                ap.edits.details.get({ packageName, editId }),
                ap.edits.tracks.list({ packageName, editId }),
                ap.edits.bundles.list({ packageName, editId }),
            ]);
            return {
                packageName,
                key: KEY,
                details: details.data,
                tracks: tracks.data.tracks || [],
                bundles: (bundles.data.bundles || []).map(b => ({ versionCode: b.versionCode, sha256: b.sha256 })),
            };
        });
        return result;
    });

tool(server, 'play_get_listing',
    'Read the store listing (title, short and full description, video) for one language, or all languages when language is omitted.',
    { packageName: pkgArg, language: z.string().optional().describe('BCP-47, e.g. th-TH or en-US') },
    async ({ packageName = DEFAULT_PACKAGE, language }) => {
        const { result } = await withEdit(packageName, async (ap, editId) => {
            if (language) return (await ap.edits.listings.get({ packageName, editId, language })).data;
            return (await ap.edits.listings.list({ packageName, editId })).data.listings || [];
        });
        return result;
    });

tool(server, 'play_list_images',
    'List the store images of one type for a language (icon, featureGraphic, phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, tvBanner, tvScreenshots, wearScreenshots).',
    { packageName: pkgArg, language: z.string(), imageType: z.string() },
    async ({ packageName = DEFAULT_PACKAGE, language, imageType }) => {
        const { result } = await withEdit(packageName, async (ap, editId) =>
            (await ap.edits.images.list({ packageName, editId, language, imageType })).data.images || []);
        return result;
    });

tool(server, 'play_get_testers',
    'Read who can test a testing track (internal, alpha, beta): the Google Groups on it. Individual email lists are managed in Play Console only.',
    { packageName: pkgArg, track: z.enum(['internal', 'alpha', 'beta']) },
    async ({ packageName = DEFAULT_PACKAGE, track }) => {
        const { result } = await withEdit(packageName, async (ap, editId) =>
            (await ap.edits.testers.get({ packageName, editId, track })).data);
        return result;
    });

tool(server, 'play_list_reviews',
    'Recent user reviews (the API returns those from about the last week), with any reply.',
    { packageName: pkgArg, maxResults: z.number().int().min(1).max(100).optional(), translationLanguage: z.string().optional() },
    async ({ packageName = DEFAULT_PACKAGE, maxResults = 50, translationLanguage }) => {
        const { data } = await api().reviews.list({ packageName, maxResults, translationLanguage });
        return (data.reviews || []).map(r => {
            const u = r.comments?.find(c => c.userComment)?.userComment;
            const d = r.comments?.find(c => c.developerComment)?.developerComment;
            return { reviewId: r.reviewId, author: r.authorName, stars: u?.starRating, text: u?.text,
                     appVersion: u?.appVersionCode, device: u?.device, androidOs: u?.androidOsVersion,
                     when: u?.lastModified?.seconds, reply: d?.text };
        });
    });

/* ---------------------------------------------------------------- change */

tool(server, 'play_upload_bundle',
    'Upload an .aab and put it on a track in one commit. status "completed" releases it (to everyone on that track, or userFraction of production users with "inProgress"); "draft" leaves it for Play Console. Production is never the default: name the track.',
    {
        packageName: pkgArg,
        aab: z.string().describe('path to the .aab (e.g. MOBILE/native/out/RanMobile-store.aab)'),
        track: z.enum(TRACKS),
        status: z.enum(['draft', 'completed', 'inProgress', 'halted']).default('completed'),
        userFraction: z.number().gt(0).lt(1).optional().describe('staged rollout share, with status inProgress'),
        releaseName: z.string().optional(),
        notes: z.record(z.string()).optional().describe('release notes by language, e.g. {"th-TH": "...", "en-US": "..."}'),
        changesNotSentForReview: reviewArg,
    },
    async ({ packageName = DEFAULT_PACKAGE, aab, track, status, userFraction, releaseName, notes, changesNotSentForReview }) => {
        const file = path.resolve(aab);
        if (!fs.existsSync(file)) throw new Error(`no file ${file}`);
        const r = await withEdit(packageName, async (ap, editId) => {
            const up = await ap.edits.bundles.upload({
                packageName, editId,
                media: { mimeType: 'application/octet-stream', body: fs.createReadStream(file) },
            }, { timeout: 15 * 60 * 1000 });
            const versionCode = String(up.data.versionCode);
            const release = { versionCodes: [versionCode], status };
            if (releaseName) release.name = releaseName;
            if (userFraction) release.userFraction = userFraction;
            const rn = notesToList(notes);
            if (rn) release.releaseNotes = rn;
            await ap.edits.tracks.update({ packageName, editId, track, requestBody: { track, releases: [release] } });
            return { versionCode, sha256: up.data.sha256, track, status };
        }, { commit: true, changesNotSentForReview });
        return { ...r.result, edit: r.committed };
    });

tool(server, 'play_set_release',
    'Set the release on a track from bundles already uploaded: promote (e.g. internal build to production), start or widen a staged rollout (inProgress + userFraction), finish it (completed), or halt it.',
    {
        packageName: pkgArg,
        track: z.enum(TRACKS),
        versionCodes: z.array(z.union([z.string(), z.number()])).min(1),
        status: z.enum(['draft', 'completed', 'inProgress', 'halted']),
        userFraction: z.number().gt(0).lt(1).optional(),
        releaseName: z.string().optional(),
        notes: z.record(z.string()).optional(),
        changesNotSentForReview: reviewArg,
    },
    async ({ packageName = DEFAULT_PACKAGE, track, versionCodes, status, userFraction, releaseName, notes, changesNotSentForReview }) => {
        const r = await withEdit(packageName, async (ap, editId) => {
            const release = { versionCodes: versionCodes.map(String), status };
            if (releaseName) release.name = releaseName;
            if (userFraction) release.userFraction = userFraction;
            const rn = notesToList(notes);
            if (rn) release.releaseNotes = rn;
            const { data } = await ap.edits.tracks.update({ packageName, editId, track, requestBody: { track, releases: [release] } });
            return data;
        }, { commit: true, changesNotSentForReview });
        return { track: r.result, edit: r.committed };
    });

tool(server, 'play_update_listing',
    'Create or change the store listing for one language. Fields left out keep their current value. Limits: title 30, shortDescription 80, fullDescription 4000 characters.',
    {
        packageName: pkgArg,
        language: z.string().describe('BCP-47, e.g. th-TH'),
        title: z.string().max(30).optional(),
        shortDescription: z.string().max(80).optional(),
        fullDescription: z.string().max(4000).optional(),
        video: z.string().optional().describe('YouTube URL'),
        changesNotSentForReview: reviewArg,
    },
    async ({ packageName = DEFAULT_PACKAGE, language, changesNotSentForReview, ...fields }) => {
        const r = await withEdit(packageName, async (ap, editId) => {
            let cur = {};
            try { cur = (await ap.edits.listings.get({ packageName, editId, language })).data; } catch { /* new language */ }
            const body = { language,
                title: fields.title ?? cur.title,
                shortDescription: fields.shortDescription ?? cur.shortDescription,
                fullDescription: fields.fullDescription ?? cur.fullDescription,
                video: fields.video ?? cur.video };
            return (await ap.edits.listings.update({ packageName, editId, language, requestBody: body })).data;
        }, { commit: true, changesNotSentForReview });
        return { listing: r.result, edit: r.committed };
    });

tool(server, 'play_update_details',
    'Change the app details: default language, contact email, website, phone.',
    {
        packageName: pkgArg,
        defaultLanguage: z.string().optional(),
        contactEmail: z.string().optional(),
        contactWebsite: z.string().optional(),
        contactPhone: z.string().optional(),
        changesNotSentForReview: reviewArg,
    },
    async ({ packageName = DEFAULT_PACKAGE, changesNotSentForReview, ...fields }) => {
        const r = await withEdit(packageName, async (ap, editId) => {
            const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
            return (await ap.edits.details.patch({ packageName, editId, requestBody: body })).data;
        }, { commit: true, changesNotSentForReview });
        return { details: r.result, edit: r.committed };
    });

tool(server, 'play_upload_images',
    'Upload store images for a language. imageType: icon (512x512 PNG), featureGraphic (1024x500), phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, tvBanner, tvScreenshots, wearScreenshots. replace=true deletes that type first.',
    {
        packageName: pkgArg,
        language: z.string(),
        imageType: z.string(),
        paths: z.array(z.string()).min(1),
        replace: z.boolean().default(false),
        changesNotSentForReview: reviewArg,
    },
    async ({ packageName = DEFAULT_PACKAGE, language, imageType, paths, replace, changesNotSentForReview }) => {
        const files = paths.map(p => path.resolve(p));
        for (const f of files) if (!fs.existsSync(f)) throw new Error(`no file ${f}`);
        const r = await withEdit(packageName, async (ap, editId) => {
            if (replace) await ap.edits.images.deleteall({ packageName, editId, language, imageType });
            const out = [];
            for (const f of files) {
                const mimeType = f.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                const { data } = await ap.edits.images.upload({ packageName, editId, language, imageType,
                    media: { mimeType, body: fs.createReadStream(f) } });
                out.push({ file: f, id: data.image?.id, sha256: data.image?.sha256 });
            }
            return out;
        }, { commit: true, changesNotSentForReview });
        return { uploaded: r.result, edit: r.committed };
    });

tool(server, 'play_set_testers',
    'Set the Google Groups that may test a testing track (internal, alpha, beta). Replaces the current list.',
    { packageName: pkgArg, track: z.enum(['internal', 'alpha', 'beta']), googleGroups: z.array(z.string()),
      changesNotSentForReview: reviewArg },
    async ({ packageName = DEFAULT_PACKAGE, track, googleGroups, changesNotSentForReview }) => {
        const r = await withEdit(packageName, async (ap, editId) =>
            (await ap.edits.testers.update({ packageName, editId, track, requestBody: { googleGroups } })).data,
            { commit: true, changesNotSentForReview });
        return { testers: r.result, edit: r.committed };
    });

tool(server, 'play_reply_review',
    'Reply to a user review (replaces an earlier reply). Max 350 characters.',
    { packageName: pkgArg, reviewId: z.string(), text: z.string().max(350) },
    async ({ packageName = DEFAULT_PACKAGE, reviewId, text }) =>
        (await api().reviews.reply({ packageName, reviewId, requestBody: { replyText: text } })).data);

tool(server, 'play_internal_share',
    'Upload an .aab to internal app sharing: returns a download link anyone the app is shared with can install from, without any track or review.',
    { packageName: pkgArg, aab: z.string() },
    async ({ packageName = DEFAULT_PACKAGE, aab }) => {
        const file = path.resolve(aab);
        if (!fs.existsSync(file)) throw new Error(`no file ${file}`);
        const { data } = await api().internalappsharingartifacts.uploadbundle({
            packageName, media: { mimeType: 'application/octet-stream', body: fs.createReadStream(file) },
        }, { timeout: 15 * 60 * 1000 });
        return data;
    });

tool(server, 'play_set_data_safety',
    'Submit the Data safety form from a CSV exported from (and in the format of) Play Console > App content > Data safety > Export to CSV.',
    { packageName: pkgArg, csv: z.string().describe('path to the CSV') },
    async ({ packageName = DEFAULT_PACKAGE, csv }) => {
        const file = path.resolve(csv);
        const safetyLabels = fs.readFileSync(file, 'utf8');
        return (await api().applications.dataSafety({ packageName, requestBody: { safetyLabels } })).data;
    });

await server.connect(new StdioServerTransport());
