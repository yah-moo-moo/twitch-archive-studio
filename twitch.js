import oauth from './oauth.js';
import logger from './logger.js';

export default class TwitchAPIClient {
    #options = null;

    /**
     * 
     * @param {Object} options 
     * @param {string} options.callback_uri
     */
    constructor(options) {
        this.#options = options;
    }

    async get_all_eventsub_subscriptions() {
        const token = await oauth.get('twitch');

        const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            headers: {
                'Client-Id': token.client_id,
                Authorization: `Bearer ${token.access_token}`
            }
        });

        const json = await res.json();
        return json.data ?? null;
    }

    async create_eventsub_subscription(type, user_id) {
        const token = await oauth.get('twitch');

        const body = {
            type: type.type,
            version: type.version,
            condition: {
                broadcaster_user_id: user_id.toString()
            },
            transport: {
                method: 'webhook',
                callback: this.#options.callback_uri.toString(),
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

    async delete_eventsub_subscription(id) {
        const token = await oauth.get('twitch');

        const res = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${id}`, {
            method: 'delete',
            headers: {
                'Client-Id': token.client_id,
                Authorization: `Bearer ${token.access_token}`
            }
        });
    }
}