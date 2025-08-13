import OAuthClient from './oauth.js';
import logger from './logger.js';

import fs from 'node:fs/promises';
import express from 'express';
import crypto from 'node:crypto';

let oauth = await OAuthClient.create({ logger, path: 'tokens.json' });

let config = null;

async function get_app_config() {
    try {
        console.log('loading app config');

        const text = await fs.readFile('config.json');
        config = JSON.parse(text);
    } catch (e) {
        console.log('error loading app config');
        console.log(e);
    }
}

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

async function twitch_api_get_all_eventsub_subscriptions() {
    const token = await oauth.get('twitch');

    const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        headers: {
            'Client-Id': token.client_id,
            Authorization: `Bearer ${token.access_token}`
        }
    });

    const json = await res.json();
    console.log(json);
    return json.data ?? null;
}

async function twitch_api_create_eventsub_subscription(type, user_id) {
    const token = await oauth.get('twitch');

    const callback_uri = new URL(config.twitch.eventsub.callback_uri_path, get_eventsub_callback_uri_base());
    const body = {
        type: type.type,
        version: type.version,
        condition: {
            broadcaster_user_id: user_id.toString()
        },
        transport: {
            method: 'webhook',
            callback: callback_uri.toString(),
            secret: EVENTSUB_SECRET
        }
    };

    const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'post',
        headers: {
            'Client-Id': token.client_id,
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token.access_token}`
        },
        body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (res.status == 202) {
        console.log(`twitch: subscription '${user_id}/${type.type}' created with status '${payload.data[0].status}'`);
        return payload;
    } else {
        console.log(`twitch: error creating subscription for '${user_id}/${type.type}'\n`);
        console.log(payload);
        return null;
    }
}

async function twitch_api_delete_eventsub_subscription(id) {
    console.log(`deleting eventsub subscription ${id}`);

    const token = await oauth.get('twitch');

    const res = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${id}`, {
        method: 'delete',
        headers: {
            'Client-Id': token.client_id,
            Authorization: `Bearer ${token.access_token}`
        }
    });

    console.log(res.status);
}

//---

const EVENTSUB_SECRET = crypto.randomBytes(32).toString('hex');

function verify_eventsub_callback(req, res) {
    console.log(`verifying eventsub callback ${req.body.subscription.id}`);
    res.set('Content-Type', 'text/plain').status(200).send(req.body.challenge);
}

function eventsub_notification_handler(notification) {
    console
    switch (notification.subscription.type) {
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
    const subs = await twitch_api_get_all_eventsub_subscriptions();

    for (const s of subs) {
        await twitch_api_delete_eventsub_subscription(s.id);
    }
}

async function create_all_eventsub_subscriptions() {
    await delete_all_eventsub_subscriptions();

    const broadcasters = config.twitch.broadcasters.filter(b => b.enabled);

    for (const b of broadcasters) {
        for (const t of EVENTSUB_SUBSCRIPTION_TYPES) {
            await twitch_api_create_eventsub_subscription(t, b.id);
        }
    }
}

//---

await get_app_config();
if (!await twitch_api_validate_token()) {
    process.exit(1);
}

const app = create_express_server();
const server = app.listen(config.express.port);

await create_all_eventsub_subscriptions();