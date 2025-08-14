import fs from 'node:fs/promises';

let config = JSON.parse(await fs.readFile('config.json'));

export default config;