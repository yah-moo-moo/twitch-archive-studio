import fs from 'node:fs/promises';
import express from 'express';

let config = null;
let tokens = null;

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

async function load_oauth_tokens() {
    try {
        console.log('loading oauth tokens');

        const text = await fs.readFile('tokens.json');
        tokens = JSON.parse(text);
    } catch (e) {
        console.log('error loading tokens');
        console.log(e);
    }
}

async function save_oauth_tokens() {
    try {
        console.log('saving oauth tokens');

        const text = JSON.stringify(tokens, null, '\t');
        await fs.writeFile('tokens.json', text);
    } catch (e) {
        console.log('error saving oauth tokens');
        console.log(e);
    }
}

//---

const TOKEN_STATE = {
    MISSING: 0,
    VALID: 1,
    EXPIRED: 2
};

function check_oauth_token_state(service) {
    console.log(`checking oauth token state for service ${service}`);

    if (tokens[service].access_token) {
        if (tokens[service].expires_at - 300 > Date.now()) {
            return TOKEN_STATE.VALID;
        } else {
            return TOKEN_STATE.EXPIRED;
        }
    } else {
        return TOKEN_STATE.MISSING;
    }
}

async function create_oauth_token(service) {
    console.log(`creating oauth token state for service ${service}`);

    const body = new URLSearchParams({
        grant_type: tokens[service].grant_type,
        client_id: tokens[service].client_id,
        client_secret: tokens[service].client_secret
    });

    const res = await fetch(tokens[service].token_uri, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });

    if (res.status == 200) {
        const json = await res.json();

        tokens[service].access_token = json.access_token;
        tokens[service].expires_at = Date.now() + json.expires_in * 1000;
        if (json.refresh_token) { tokens[service].refresh_token = json.refresh_token; }

        await save_oauth_tokens();
        return true;
    } else {
        return false;
    }
}

async function renew_oauth_token(service) {
    console.log(`renewing oauth token for service ${service}`);

    if (tokens[service].grant_type == "client_credentials") {
        await create_oauth_token(service);
    }
}

async function get_oauth_token(service) {
    console.log(`getting oauth token for service ${service}`);

    const state = check_oauth_token_state(service);
    if (state == TOKEN_STATE.MISSING || state == TOKEN_STATE.EXPIRED) {
        await renew_oauth_token(service);
    }

    if (check_oauth_token_state(service) == TOKEN_STATE.VALID) {
        return tokens[service].access_token;
    }
}

//---

async function test_twitch_api() {
    console.log(`testing twitch api`);
    const token = get_oauth_token('twitch');

    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (res.status == 200) {
        return true;
    } else {
        return false;
    }
}

//---

await get_app_config();
await load_oauth_tokens();
await test_twitch_api();