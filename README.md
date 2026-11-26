# discord-bot

A small personal Discord bot for voice, music and fun. Built with [discord.js](https://discord.js.org/).

## Features

- **Music** — play from a title or URL, queue, skip, volume, stop.
- **Sounds** — list and play local sound files in voice, or cut a new one from a YouTube link with `ffmpeg`.
- **Game status** — query a Rust server (players / queue) via [`gamedig`](https://github.com/gamedig/node-gamedig).
- **Fun** — `uwu` text, random reactions, a tiny Markov chain that mimics chat, and occasional random GIFs.

## Requirements

- **Node.js 18+**
- **ffmpeg** available on `PATH` (used for cutting sounds / audio)
- A Discord bot application with the **Message Content** intent enabled

## Setup

```sh
git clone https://github.com/Keymil0/discord-bot.git
cd discord-bot
npm install
```

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_bot_token

# optional (defaults shown)
LOG_CHANNEL=bot-logs
RUST_HOST=127.0.0.1
RUST_QUERY_PORT=28015
```

Run it:

```sh
npm start      # node index.js
npm run dev    # nodemon
```

## Commands

| Command | Description |
| --- | --- |
| `!help` | List commands |
| `!ping` | Bot latency |
| `!play <title/url>` | Play a song in your voice channel |
| `!queue` | Show the queue |
| `!skip` | Skip the current track |
| `!volume <0-200>` | Set playback volume |
| `!stop` / `!leave` | Stop and leave voice |
| `!sound` / `!sounds` | List available sounds |
| `!sound <name>` | Play a sound in voice |
| `!dodajsound <name> <url> <start> <end>` | Cut a sound from YouTube and add it |
| `!uwu <text>` | uwu-ify text |
| `!rust` | Show status of the configured Rust server |

## Notes

- Sound files are read from `./sounds` (optional — create the folder and drop in your own `.mp3` / `.ogg` / `.wav` files).
- `chat_log.txt` is generated locally for the Markov feature and is git-ignored.
- `.env` is git-ignored — **never commit your bot token**.

## License

ISC (see `package.json`).
