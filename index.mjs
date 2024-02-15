#! /usr/bin/env node

import { spawn } from 'child_process'
import { PulseAudio, PA_SAMPLE_FORMAT, sampleSize } from 'pulseaudio.js'
import wav from 'wav'
import Hypercore from 'hypercore'
import Hyperswarm from 'hyperswarm'
import { HttpAudioStreamer } from 'pear-radio-backend'
import ram from 'random-access-memory'

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'stream':
    if (args.length !== 1) {
      printHelp()
      process.exit(1)
    }
    stream(Buffer.from(args[0], 'hex'))
    break

  case 'record':
    if (args.length !== 1) {
      printHelp()
      process.exit(1)
    }
    record(Number(args[0]))
    break

  case 'list':
    await listInputs()
    process.exit(0)

  case '-h':
  case '--help':
  case 'help':
  default:
    printHelp()
    process.exit(1)
}

function printHelp () {
  console.log(`- pearstream -

stream audio to pears

usage:
  pear stream <key>
  pear record <output_index> (assumes pulseaudio and lame are installed)
  pear list                  (assumes pulseaudio is installed)
  pear help
`)
}

async function stream (key) {
  const core = new Hypercore('./storage', key)
  await core.ready()
  
  const swarm = new Hyperswarm()
  swarm.on('connection', conn => {
    console.log('connection')
    core.replicate(conn)
  })
  
  swarm.join(core.discoveryKey)
  await swarm.flush()
  
  const stream = core.createReadStream({ live: true, start: 0 })
  
  const httpAudioStreamer = new HttpAudioStreamer({ cli: true })
  await httpAudioStreamer.ready()
  httpAudioStreamer.stream(stream)
  
  console.log('Streaming to http://localhost:' + httpAudioStreamer.port)
}

async function listInputs () {
  const pa = new PulseAudio()
  await pa.connect()

  console.log('-- Server Info --')
  console.log(await pa.getServerInfo())

  console.log('\n-- Sources --')
  for (const source of await pa.getAllSources()) {
    console.log(source.name)
    console.log(`  index: ${source.index}`)
    console.log(`  description: ${source.description}`)
    console.log()
  }

  await pa.disconnect()
}
  
async function record (index) {
  const pa = new PulseAudio()
  const swarm = new Hyperswarm()

  const core = new Hypercore('./storage')
  await core.ready()

  swarm.on('connection', conn => {
    console.log('connection!')
    core.replicate(conn)
  })

  swarm.join(core.discoveryKey)
  await swarm.flush()

  console.log('key', core.key.toString('hex'))
  console.log('discoveryKey', core.discoveryKey.toString('hex'))

  const rate = 44100
  const channels = 2
  const format = PA_SAMPLE_FORMAT.S16LE

  const writer = new wav.Writer({
    sampleRate: rate,
    channels,
    bitDepth: sampleSize[format] * 8
  })

  const stream = await pa.createRecordStream({
    index,
    sampleSpec: {
      rate,
      format,
      channels
    }
  })

  const encoding = spawn('lame', [
    '-b 128',
    '-s 44.1',
    '-',
    '-'
  ])

  const writeStream = core.createWriteStream()

  stream.pipe(writer)
  writer.pipe(writeStream)

  encoding.stderr.pipe(process.stderr)
}

