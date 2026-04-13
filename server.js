const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const express = require('express')
const axios = require('axios')
const qrcode = require('qrcode')
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const app = express()
app.use(express.json())
app.use(express.static('public'))

const upload = multer({ dest: 'uploads/' })

// ── WhatsApp client ──────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: { args: ['--no-sandbox'] }
})

let qrImageData = null
let isReady = false

client.on('qr', async (qr) => {
  qrImageData = await qrcode.toDataURL(qr)
  console.log('请打开 http://localhost:3000 扫描二维码')
})

client.on('ready', () => {
  isReady = true
  console.log('WhatsApp 已连接！')
})

client.initialize()

// ── 天气 API（图卢兹）────────────────────────────────────────
async function getToulouseWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast'
  const { data } = await axios.get(url, {
    params: {
      latitude: 43.6047,
      longitude: 1.4442,
      daily: 'temperature_2m_max,temperature_2m_min,weathercode',
      current_weather: true,
      timezone: 'Europe/Paris'
    }
  })

  const code = data.current_weather.weathercode
  const temp = Math.round(data.current_weather.temperature)
  const max = Math.round(data.daily.temperature_2m_max[0])
  const min = Math.round(data.daily.temperature_2m_min[0])
  const desc = weatherDesc(code)

  return { temp, max, min, desc }
}

function weatherDesc(code) {
  if (code === 0) return '晴天 ☀️'
  if (code <= 2) return '晴转多云 ⛅'
  if (code <= 3) return '阴天 ☁️'
  if (code <= 67) return '有雨 🌧️'
  if (code <= 77) return '有雪 🌨️'
  if (code <= 99) return '雷雨 ⛈️'
  return '天气未知'
}

// ── 路由 ─────────────────────────────────────────────────────
app.get('/qr', (req, res) => {
  res.json({ qr: qrImageData, ready: isReady })
})

app.get('/weather', async (req, res) => {
  try {
    const weather = await getToulouseWeather()
    res.json(weather)
  } catch (e) {
    res.status(500).json({ error: '天气获取失败' })
  }
})

app.get('/contacts', async (req, res) => {
  if (!isReady) return res.status(400).json({ error: '未连接' })
  const contacts = await client.getContacts()
  const filtered = contacts
    .filter(c => c.name && c.isMyContact)
    .map(c => ({ id: c.id._serialized, name: c.name }))
  res.json(filtered)
})

app.post('/send', upload.single('image'), async (req, res) => {
  if (!isReady) return res.status(400).json({ error: 'WhatsApp 未连接' })

  const { to, date, weather, mood, message, question } = req.body

  // 组装消息
  let text = ''
  text += `📅 *${date}*\n`
  text += `🌤️ 图卢兹今天 ${weather}\n`
  if (mood) text += `${mood}\n`
  if (message) text += `\n💬 ${message}\n`
  if (question) text += `\n❓ ${question}`

  try {
    // 发送文字
    await client.sendMessage(to, text)

    // 发送图片（如果有）
    if (req.file) {
      const media = MessageMedia.fromFilePath(req.file.path)
      await client.sendMessage(to, media)
      fs.unlinkSync(req.file.path)
    }

    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(3000, () => console.log('打开浏览器访问 http://localhost:3000'))