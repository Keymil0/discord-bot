require('dotenv').config();
const TOKEN = process.env.DISCORD_TOKEN;
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Ytdl } = require('@distube/ytdl-core');
const { GameDig } = require('gamedig');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const emojilib = require('emojilib');

const LOG_FILE = './chat_log.txt';
const RUST_HOST = process.env.RUST_HOST || '127.0.0.1';
const RUST_QUERY_PORT = Number(process.env.RUST_QUERY_PORT) || 28015;

const gameDig = new GameDig();
const ytdl = new Ytdl();
const music = new Map();

const SOUNDS_DIR = './sounds';
const ALL_REACTION_EMOJIS = Object.keys(emojilib);
const POPULAR_REACTION_EMOJIS = ['😂', '😭', '😅', '🤣', '🔥', '❤️', '🙏', '😍', '😊', '💀', '👍', '😎', '🥺', '😳', '🤔', '😩', '🙌', '😁', '😢', '👀', '💯', '🗿', '🐐', '🐹', '🤡'];

function pickReactionEmoji() {
    if (Math.random() < 0.7) {
        return POPULAR_REACTION_EMOJIS[Math.floor(Math.random() * POPULAR_REACTION_EMOJIS.length)];
    }
    return ALL_REACTION_EMOJIS[Math.floor(Math.random() * ALL_REACTION_EMOJIS.length)];
}

const SOUND_MIN_MS = 15 * 60 * 1000;
const SOUND_MAX_MS = 45 * 60 * 1000;
const LOG_CHANNEL_NAME = process.env.LOG_CHANNEL || 'bot-logs';
const lastVoiceChannel = new Map();
let soundConnection = null;
let soundTimer = null;
let reactionBoostUntil = 0;

function getQueue(guildId) {
    if (!music.has(guildId)) {
        const q = {
            tracks: [],
            player: createAudioPlayer(),
            connection: null,
            textChannel: null,
            playing: false,
            volume: 100,
            resource: null
        };
        q.player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
        q.player.on('error', (err) => {
            console.error('player error:', err?.message || err);
            playNext(guildId);
        });
        music.set(guildId, q);
    }
    return music.get(guildId);
}

async function playNext(guildId) {
    const q = getQueue(guildId);
    if (q.tracks.length === 0) {
        q.playing = false;
        return;
    }
    const track = q.tracks.shift();
    q.playing = true;
    try {
        const stream = await ytdl.download(track.url, { quality: 'highestaudio' });
        const resource = createAudioResource(stream, { inlineVolume: true });
        resource.volume.setVolume(q.volume / 100);
        q.resource = resource;
        q.player.play(resource);
        console.log(`playing: ${track.title} (${track.url})`);
        if (q.textChannel) q.textChannel.send(`\u25b6 now playing: **${track.title}**`);
    } catch (err) {
        console.error('playNext error:', err?.stack || err);
        if (q.textChannel) q.textChannel.send('failed to play, skipping');
        q.playing = false;
        playNext(guildId);
    }
}

function parseRustTag(tags, prefix) {
    const tag = tags.find(t => t.startsWith(prefix));
    if (!tag) return 0;
    const n = parseInt(tag.slice(prefix.length), 10);
    return Number.isNaN(n) ? 0 : n;
}

function getRandomGif() {
    if (!fs.existsSync(LOG_FILE)) return null;
    const fileData = fs.readFileSync(LOG_FILE, 'utf8');
    const gifUrls = fileData.match(/https?:\/\/\S+\.(?:gif|tenor\.com\S*|giphy\.com\S*)/gi);
    if (!gifUrls || gifUrls.length === 0) return null;
    return gifUrls[Math.floor(Math.random() * gifUrls.length)];
}

function uwuify(text) {
    return text
        .replace(/r|l/g, 'w')
        .replace(/R|L/g, 'W')
        .replace(/n([aeiou])/g, 'ny$1')
        .replace(/N([aeiou])/g, 'Ny$1')
        .replace(/N([AEIOU])/g, 'Ny$1')
        .replace(/ove/g, 'uv')
        .replace(/!+/g, ' uwu')
        .replace(/\?+/g, ' owo');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let logBuffer = [];
let logReady = false;

function getLogChannel() {
    const name = LOG_CHANNEL_NAME.toLowerCase();
    for (const guild of client.guilds.cache.values()) {
        const ch = guild.channels.cache.find(c => c.name.toLowerCase() === name && c.isTextBased());
        if (ch) return ch;
    }
    return null;
}

function voiceChannelHasMembers(channel) {
    return channel.guild.voiceStates.cache.some(vs => vs.channelId === channel.id && vs.id !== client.user.id);
}

const LEVEL_EMOJI = { LOG: '📡', WARN: '⚠️', ERR: '❌' };

function logTimestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ; ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function writeLog(level, args) {
    let text = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
    const emoji = LEVEL_EMOJI[level] || '📡';
    const line = `[${logTimestamp()}]  -  ${emoji} ${text}`.slice(0, 1900);
    if (!logReady) {
        logBuffer.push(line);
        if (logBuffer.length > 200) logBuffer.shift();
        return;
    }
    const ch = getLogChannel();
    if (ch) ch.send('`' + line.replace(/`/g, "'") + '`').catch(() => { });
}

function setupLogForwarding() {
    const origLog = console.log.bind(console);
    const origErr = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.log = (...a) => { origLog(...a); writeLog('LOG', a); };
    console.error = (...a) => { origErr(...a); writeLog('ERR', a); };
    console.warn = (...a) => { origWarn(...a); writeLog('WARN', a); };
}
setupLogForwarding();

function generateMarkovText(text) {
    const words = text.split(/\s+/);
    const chain = {};
    for (let i = 0; i < words.length - 2; i++) {
        const key = words[i] + ' ' + words[i + 1];
        const nextWord = words[i + 2];
        if (!chain[key]) chain[key] = [];
        chain[key].push(nextWord);
    }

    const keys = Object.keys(chain);
    if (keys.length === 0) return '';

    let randomKey = keys[Math.floor(Math.random() * keys.length)];
    let parts = randomKey.split(' ');
    let result = [...parts];

    for (let i = 0; i < 15; i++) {
        const currentKey = parts[parts.length - 2] + ' ' + parts[parts.length - 1];
        const nextWords = chain[currentKey];
        if (!nextWords || nextWords.length === 0) break;
        const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];
        result.push(nextWord);
        parts.shift();
        parts.push(nextWord);

        if (Math.random() < 0.35) {
            break;
        }
    }

    return result.join(' ');
}

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
    logReady = true;
    const ch = getLogChannel();
    if (ch) {
        for (const line of logBuffer) {
            ch.send('`' + line.replace(/`/g, "'") + '`').catch(() => { });
        }
        logBuffer = [];
        console.log(`logs -> channel #${LOG_CHANNEL_NAME}`);
    } else {
        console.log(`[logs] channel #${LOG_CHANNEL_NAME} not found, logging to console only`);
    }
    scheduleRandomSound();
});

function getSoundFiles() {
    if (!fs.existsSync(SOUNDS_DIR)) return [];
    return fs.readdirSync(SOUNDS_DIR).filter(f => /\.(mp3|ogg|wav|m4a|webm|opus)$/i.test(f));
}

function parseTime(str) {
    const parts = String(str).split(':').map(Number);
    if (parts.some(n => Number.isNaN(n)) || parts.length === 0) return null;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec;
}

function joinAndPlaySound(guild, fileName) {
    const channelId = lastVoiceChannel.get(guild.id);
    if (!channelId) { console.log('[sound] no remembered channel'); return Promise.resolve(); }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) { console.log('[sound] channel not found or not a voice channel'); return Promise.resolve(); }
    if (!voiceChannelHasMembers(channel)) { console.log('[sound] no one in the channel'); return Promise.resolve(); }
    const existing = music.get(guild.id);
    if (existing && existing.connection && existing.connection.state.status !== VoiceConnectionStatus.Destroyed) { console.log('[sound] music is playing, skipping'); return Promise.resolve(); }

    console.log('[sound] joining channel', channel.name);
    const player = createAudioPlayer();
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });
    connection.on('error', (err) => console.log('[sound] connection error:', err?.message || err));
    connection.on(VoiceConnectionStatus.Ready, () => console.log('[sound] connected to voice'));
    connection.subscribe(player);
    soundConnection = connection;

    let resource;
    try {
        resource = createAudioResource(path.join(SOUNDS_DIR, fileName), { inlineVolume: true });
        resource.volume.setVolume(0.9);
    } catch (err) {
        console.log('[sound] resource error:', err?.message || err);
        connection.destroy();
        soundConnection = null;
        return Promise.resolve();
    }

    console.log('[sound] playing', fileName);
    player.play(resource);
    return new Promise((resolve) => {
        let finished = false;
        let timer;
        function done() {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { connection.destroy(); } catch (e) { }
            if (soundConnection === connection) soundConnection = null;
            resolve();
        }
        player.once(AudioPlayerStatus.Idle, done);
        player.once('error', (err) => {
            console.log('[sound] playback error:', err?.message || err);
            done();
        });
        connection.once(VoiceConnectionStatus.Disconnected, done);
        timer = setTimeout(done, 30000);
    });
}

async function maybePlayRandomSound() {
    const files = getSoundFiles();
    console.log('[sound] tick, files:', files.length);
    if (files.length === 0) return;
    for (const q of music.values()) {
        if (q.playing) { console.log('[sound] skipping (music playing)'); return; }
    }
    const file = files[Math.floor(Math.random() * files.length)];
    let target = null;
    for (const guild of client.guilds.cache.values()) {
        const rememberedId = lastVoiceChannel.get(guild.id);
        const remembered = rememberedId ? guild.channels.cache.get(rememberedId) : null;
        if (remembered && remembered.isVoiceBased() && voiceChannelHasMembers(remembered)) {
            target = remembered;
            break;
        }
        const anyVc = guild.channels.cache.find(c => c.isVoiceBased() && voiceChannelHasMembers(c));
        if (!target && anyVc) target = anyVc;
    }
    if (!target) {
        console.log('[sound] no one in any voice channel');
        return;
    }
    lastVoiceChannel.set(target.guild.id, target.id);
    console.log('[sound] playing:', file, 'on channel', target.name);
    await joinAndPlaySound(target.guild, file);
}

function scheduleRandomSound() {
    const delay = SOUND_MIN_MS + Math.random() * (SOUND_MAX_MS - SOUND_MIN_MS);
    console.log(`[sound] next in ${Math.round(delay / 1000)}s`);
    soundTimer = setTimeout(async () => {
        soundTimer = null;
        await maybePlayRandomSound();
        scheduleRandomSound();
    }, delay);
}

async function addSoundFromYoutube(name, url, startSec, durationSec) {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    const outPath = path.join(SOUNDS_DIR, `${safe}.mp3`);
    const stream = ytdl.download(url, { quality: 'highestaudio' });
    const args = ['-y', '-i', '-', '-ss', String(startSec), '-t', String(durationSec), '-vn', '-codec:a', 'libmp3lame', '-q:a', '4', outPath];
    const ff = spawn('ffmpeg', args, { windowsHide: true });
    stream.pipe(ff.stdin);
    ff.stdin.on('error', () => { });
    stream.on('error', () => { });
    return new Promise((resolve, reject) => {
        ff.on('error', reject);
        ff.on('close', (code) => {
            stream.destroy();
            if (code === 0) resolve(safe);
            else reject(new Error('ffmpeg exit ' + code));
        });
    });
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (content === '!help') {
        const embed = new EmbedBuilder()
            .setColor(0xce422b)
            .setTitle('commands')
            .setDescription('**!help** — this list\n**!ping** — bot ping\n**!rust** — EU Friday status (players/queue)\n**!uwu <text>** — uwu-ify text\n**!play <title/url>** — play a song in voice\n**!skip** — next\n**!queue** — queue\n**!volume <0-200>** — volume\n**!stop** — stop and leave\n');
        return message.reply({ embeds: [embed] });
    }

    if (content === '!sound' || content === '!sounds') {
        const files = getSoundFiles();
        if (files.length === 0) return message.reply('no sounds. drop mp3/ogg files into ./sounds or use !dodajsound');
        const names = files.map(f => f.replace(/\.[^.]+$/, '')).join(', ');
        return message.reply('sounds: ' + names);
    }

    if (content.startsWith('!sound ')) {
        const name = content.slice(7).trim().toLowerCase();
        const files = getSoundFiles();
        const file = files.find(f => f.toLowerCase().replace(/\.[^.]+$/, '') === name || f.toLowerCase().startsWith(name));
        if (!file) return message.reply('no such sound. list: !sound');
        let vc = message.member?.voice?.channel;
        if (!vc) {
            vc = message.guild.channels.cache.find(c => c.isVoiceBased() && voiceChannelHasMembers(c));
        }
        if (!vc) return message.reply('join a voice channel first (or no one is in voice)');
        lastVoiceChannel.set(message.guild.id, vc.id);
        joinAndPlaySound(message.guild, file);
        return message.reply(`playing: **${file.replace(/\.[^.]+$/, '')}**`);
    }

    if (content.startsWith('!dodajsound')) {
        const args = content.slice(11).trim().split(/\s+/);
        if (args.length < 4) return message.reply('usage: !dodajsound <name> <url> <start> <end>  (times e.g. 1:23)');
        const [name, url, startStr, endStr] = args;
        const start = parseTime(startStr);
        const end = parseTime(endStr);
        if (start === null || end === null || end <= start) return message.reply('bad times, format e.g. 1:23 or 45');
        message.reply('cutting sound, one sec...');
        try {
            const safe = await addSoundFromYoutube(name, url, start, end - start);
            return message.reply(`added: **${safe}**`);
        } catch (err) {
            console.error(err);
            return message.reply('failed to cut sound');
        }
    }

    if (content.startsWith('!uwu')) {
        const target = content.slice(4).trim();
        if (!target) return message.reply('uwu give me some text >w<');
        return message.reply(uwuify(target));
    }

    if (content === '!ping') {
        const wsLatency = client.ws.ping;
        return message.reply(`pong ${wsLatency}ms`);
    }

    if (content === '!emojitest') {
        reactionBoostUntil = Date.now() + 30000;
        return message.reply('ok, reacting to almost every message for 30s');
    }

    if (content === '!rust') {
        try {
            const state = await gameDig.query({
                type: 'rust',
                host: RUST_HOST,
                port: RUST_QUERY_PORT,
                socketTimeout: 5000,
                attemptTimeout: 5000,
                maxAttempts: 1
            });

            const players = state.players.length;
            const maxPlayers = state.maxplayers;
            const tags = state.raw?.tags ?? [];
            const queue = parseRustTag(tags, 'qp');

            const text = `${state.name} | players: ${players}/${maxPlayers} | queue: ${queue}`;
            return message.reply(text);
        } catch (err) {
            console.error(err);
            return message.reply('server offline');
        }
    }

    if (content.startsWith('!play')) {
        const query = content.slice(5).trim();
        if (!query) return message.reply('usage: !play <title or url>');
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) return message.reply('join a voice channel first');
        lastVoiceChannel.set(message.guild.id, voiceChannel.id);
        try {
            let url = query;
            let title = query;
            if (/^https?:\/\//.test(query)) {
                const info = await ytdl.getInfo(query);
                title = info.videoDetails?.title || query;
            } else {
                const results = await ytdl.search(query, { type: 'video', limit: 1 });
                if (!results || results.length === 0) return message.reply('nothing found');
                url = results[0].url;
                title = results[0].title;
            }
            const q = getQueue(message.guild.id);
            q.textChannel = message.channel;
            const startNow = !q.playing;
            q.tracks.push({ url, title });
            if (!q.connection) {
                q.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });
                q.connection.on('error', (err) => console.error('voice connection error:', err?.message || err));
                q.connection.on(VoiceConnectionStatus.Ready, () => console.log('voice connection ready'));
                q.connection.on(VoiceConnectionStatus.Disconnected, () => console.log('voice connection disconnected'));
                q.connection.subscribe(q.player);
            }
            if (startNow) {
                await playNext(message.guild.id);
            } else {
                await message.reply(`added to queue: **${title}**`);
            }
        } catch (err) {
            console.error(err);
            return message.reply('failed to search/play');
        }
        return;
    }

    if (content === '!skip') {
        const q = getQueue(message.guild.id);
        if (!q.playing && q.tracks.length === 0) return message.reply('nothing is playing');
        q.player.stop(true);
        return message.reply('skipped');
    }

    if (content.startsWith('!volume')) {
        const q = getQueue(message.guild.id);
        const arg = content.slice(7).trim();
        if (!arg) return message.reply(`volume: **${q.volume}%**`);
        const vol = parseInt(arg, 10);
        if (Number.isNaN(vol) || vol < 0 || vol > 200) return message.reply('usage: !volume <0-200>');
        q.volume = vol;
        if (q.resource) q.resource.volume.setVolume(vol / 100);
        return message.reply(`volume set to **${vol}%**`);
    }

    if (content === '!stop' || content === '!leave') {
        const q = getQueue(message.guild.id);
        q.tracks = [];
        q.playing = false;
        q.player.stop(true);
        if (q.connection) {
            q.connection.destroy();
            q.connection = null;
        }
        return message.reply('stopped, leaving');
    }

    if (content === '!queue') {
        const q = getQueue(message.guild.id);
        if (q.tracks.length === 0) return message.reply('queue empty');
        const list = q.tracks.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
        return message.reply('queue:\n' + list);
    }

    if (!content.startsWith('!') && content.length > 2) {
        fs.appendFileSync(LOG_FILE, content + ' ', 'utf8');
    }

    const reactionChance = Date.now() < reactionBoostUntil ? 0.9 : 0.04;
    if (Math.random() < reactionChance) {
        try {
            await message.react(pickReactionEmoji());
        } catch (e) { }
    }

    if (Math.random() < 0.07 || message.mentions.has(client.user)) {
        if (!fs.existsSync(LOG_FILE)) return;
        const fileData = fs.readFileSync(LOG_FILE, 'utf8');
        const generated = generateMarkovText(fileData);
        if (generated.length > 3) {
            await message.reply({
                content: generated,
                allowedMentions: { repliedUser: false }
            });
        }
    }

    if (!content.startsWith('!') && Math.random() < 0.03) {
        const randomGif = getRandomGif();
        if (randomGif) {
            await message.reply({
                content: randomGif,
                allowedMentions: { repliedUser: false }
            });
        }
    }
});

client.login(TOKEN);
