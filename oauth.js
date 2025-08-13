import fs from 'node:fs/promises';

const STATE = {
    MISSING: 'missing',
    VALID: 'valid',
    EXPIRED: 'expired'
};

export default class OAuthClient {
    #options = null;
    #services = {};

    /**
     * 
     * @param {Object} options 
     * @param {string} options.path
     */
    static async create(options) {
        const client = new OAuthClient();
        client.#options = options;
        await client.#load();
        return client;
    }

    async #load() {
        this.#services = JSON.parse(await fs.readFile(this.#options.path));
    }

    async #save() {
        await fs.writeFile(this.#options.path, JSON.stringify(this.#services, null, '\t'));
    }

    #check_state(service) {
        if (this.#services[service].access_token) {
            if (this.#services[service].expires_at - 300 > Date.now()) {
                return STATE.VALID;
            } else {
                return STATE.EXPIRED;
            }
        } else {
            return STATE.MISSING;
        }
    }

    async create(service) {
        const body = new URLSearchParams({
            grant_type: this.#services[service].grant_type,
            client_id: this.#services[service].client_id,
            client_secret: this.#services[service].client_secret
        });

        const res = await fetch(this.#services[service].token_uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });

        const json = await res.json();

        if (res.status == 200) {
            this.#services[service].access_token = json.access_token;
            this.#services[service].expires_at = Date.now() + json.expires_in * 1000;
            if (json.refresh_token) { this.#services[service].refresh_token = json.refresh_token; }

            await save();
        }
    }

    async #renew(service) {
        if (this.#services[service].grant_type == "client_credentials") {
            await create(service);
        }
    }

    /**
     * 
     * @param {string} service 
     */
    async get(service) {
        let state = this.#check_state(service);
        if (state == STATE.MISSING || state == STATE.EXPIRED) {
            await this.#renew(service);
        }

        if (this.#check_state(service) == STATE.VALID) {
            return {
                client_id: this.#services[service].client_id,
                access_token: this.#services[service].access_token
            };
        }
    }
}