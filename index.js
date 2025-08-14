import logger from './logger.js';
import oauth from './oauth.js';
import TwitchAPIClient from './twitch.js';
import config from './config.js';

import express from 'express';
import path from 'node:path';
import { spawn } from 'node:child_process';

//---

async function twitch_api_validate_token() {
    console.log(`testing twitch api`);
    const token = await oauth.get('twitch');

    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: {
            Authorization: `Bearer ${token.access_token}`
        }
    });

    const json = await res.json();
    console.log(json);

    return (res.status == 200);
}

//---

/**
 * 
 * @param {Object} options 
 * @param {string} options.token
 * @param {string} options.url
 * @param {string} options.prefix
 * @param {string} options.transcode
 * @returns {Promise<void>}
 */
async function spawn_streamlink_instance(options) {
    return new Promise((resolve) => {
        const path_prefix = path.join(config.streamlink.output, options.prefix);
        const args = [
            `--twitch-api-header=Authorization=OAuth ${options.token}`,
            options.transcode ?
                ['--record', path_prefix + 'ts',
                    '--player', config.ffmpeg.path,
                    '--player-verbose',
                    '--player-args', `-c copy "${path_prefix}.mp4" -i`,
                    '--player-no-close']
                : ['--output', path_prefix + '.ts'],
            '--hls-live-restart',
            '--loglevel', 'debug',
            '--stream-segment-threads', '10',
            '--stream-timeout', '100',
            '--hls-segment-queue-threshold', '0',
            '--url', options.url,
            '--default-stream', 'best'
        ];

        logger.debug('spawn streamlink instance');
        logger.debug([config.streamlink.path, args].flat().join(' '));
        const process = spawn(config.streamlink.path, args, { shell: false, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

        process.stderr.on('data', (data) => { console.log('err: ' + data.toString()); });
        process.stdout.on('data', (data) => { console.log('out: ' + data.toString().trim()); });
        process.on('exit', () => resolve());
    });
}

//---

function verify_eventsub_callback(req, res) {
    console.log(`verifying eventsub callback ${req.body.subscription.id}`);
    res.set('Content-Type', 'text/plain').status(200).send(req.body.challenge);
}

const SUB_TYPE = {
    STREAM_ONLINE: 'stream.online',
    STREAM_OFFLINE: 'stream.offline',
    CHANNEL_UPDATE: 'channel.update'
}

async function twitch_eventsub_stream_online(event) {
    spawn_streamlink_instance({
        token: config.streamlink.token,
        url: `https://www.twitch.tv/${event.broadcaster_user_login}`,
        prefix: event.broadcaster_user_login + '_' + event.id + '.stream',
        transcode: true
    });
}

function eventsub_notification_handler(notification) {
    console
    switch (notification.subscription.type) {
        case SUB_TYPE.STREAM_ONLINE:
            twitch_eventsub_stream_online(notification.event);
            break;

        default:
            console.log('eventsub: unknown event received');
            console.log(notification);
            break;
    }
}

function eventsub_callback_handler(req, res) {
    switch (req.headers['twitch-eventsub-message-type']) {
        case 'webhook_callback_verification':
            verify_eventsub_callback(req, res);
            break;
        case 'notification':
            eventsub_notification_handler(req.body);
            res.status(202).send();
            break;
        case 'revocation':
            res.status(202).send();
            break;
        default:
            res.status(400).send();
    }
}

//---

function get_eventsub_callback_uri_base() {
    switch (config.callback_method) {
        case "direct":
            return config.direct_callback_uri_base;
    }
}

function create_express_server() {
    console.log('creating express server');

    const app = express();
    app.use(express.json());

    app.post(config.twitch.eventsub.callback_uri_path, (req, res) => eventsub_callback_handler(req, res));

    return app;
}

//---

const EVENTSUB_SUBSCRIPTION_TYPES = [
    { type: 'stream.online', version: 1 },
    { type: 'stream.offline', version: 1 },
    { type: 'channel.update', version: 2 }
];

async function delete_all_eventsub_subscriptions() {
    const subs = await twitch.get_all_eventsub_subscriptions();

    for (const s of subs) {
        await twitch.delete_eventsub_subscription(s.id);
    }
}

async function create_all_eventsub_subscriptions() {
    await delete_all_eventsub_subscriptions();

    const broadcasters = config.twitch.broadcasters.filter(b => b.enabled);

    for (const b of broadcasters) {
        for (const t of EVENTSUB_SUBSCRIPTION_TYPES) {
            await twitch.create_eventsub_subscription(t, b.id);
        }
    }
}

//---

const twitch = new TwitchAPIClient({ callback_uri: new URL(config.twitch.eventsub.callback_uri_path, get_eventsub_callback_uri_base()) });

if (!await twitch_api_validate_token()) {
    process.exit(1);
}

const app = create_express_server();
const server = app.listen(config.express.port);

await create_all_eventsub_subscriptions();