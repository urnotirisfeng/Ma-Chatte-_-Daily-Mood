const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const express = require('express')
const axios = require('axios')
const qrcode = require('qrcode')
const multer = require('multer')
const fs = require('fs')

const app = express()
app.use(express.json())
app.use(express.static('public'))

const upload = multer({ dest: 'uploads/' })

// ── WhatsApp ─────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: { args: ['--no-sandbox'] }
})

let qrImageData = null
let isReady = false

client.on('qr', async (qr) => {
  qrImageData = await qrcode.toDataURL(qr)
  console.log('二维码已生成，请打开 http://localhost:3000/scan 扫码')
})

client.on('ready', () => {
  isReady = true
  console.log('✅ WhatsApp 已连接！')
})

client.initialize()

// ── 天气（图卢兹）────────────────────────────────
async function getWeather() {
  const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
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
  const max  = Math.round(data.daily.temperature_2m_max[0])
  const min  = Math.round(data.daily.temperature_2m_min[0])
  const desc = weatherDesc(code)
  return { temp, max, min, desc }
}

function weatherDesc(code) {
  if (code === 0)  return 'Ensoleillé ☀️'
  if (code <= 2)   return 'Partiellement nuageux ⛅'
  if (code <= 3)   return 'Nuageux ☁️'
  if (code <= 67)  return 'Pluvieux 🌧️'
  if (code <= 77)  return 'Neigeux 🌨️'
  if (code <= 99)  return 'Orageux ⛈️'
  return 'Météo inconnue'
}

// ── 路由 ─────────────────────────────────────────

// 前端轮询用，返回 JSON
app.get('/qr', (req, res) => {
  if (isReady) {
    res.json({ ready: true })
  } else {
    res.json({ ready: false, qr: qrImageData })
  }
})

// 扫码页面（人工打开）
app.get('/scan', (req, res) => {
  if (isReady) {
    return res.send('<h2 style="font-family:sans-serif;padding:20px;color:green">✅ 已连接！<a href="/">返回主页</a></h2>')
  }
  if (!qrImageData) {
    return res.send('<h2 style="font-family:sans-serif;padding:20px;">⏳ 二维码生成中，请稍后刷新...</h2>')
  }
  res.send(`
    <html><body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f2f5;flex-direction:column;font-family:sans-serif;">
      <h2 style="margin-bottom:20px;">用手机 WhatsApp 扫描二维码</h2>
      <img src="${qrImageData}" style="width:280px;height:280px;border:4px solid #075e54;border-radius:12px;" />
      <p style="margin-top:16px;color:#666;">扫码后请刷新主页面</p>
      <script>setTimeout(()=>location.reload(), 4000)</script>
    </body></html>
  `)
})

// 天气
app.get('/weather', async (req, res) => {
  try {
    res.json(await getWeather())
  } catch(e) {
    res.status(500).json({ error: '天气获取失败' })
  }
})

// 联系人
app.get('/contacts', async (req, res) => {
  if (!isReady) return res.status(400).json({ error: '未连接' })
  const contacts = await client.getContacts()
  const filtered = contacts
    .filter(c => c.name && c.isMyContact)
    .map(c => ({ id: c.id._serialized, name: c.name }))
  res.json(filtered)
})

// 发送
app.post('/send', upload.single('image'), async (req, res) => {
  if (!isReady) return res.status(400).json({ error: 'WhatsApp 未连接' })
  const { to, date, weather, mood, message, question } = req.body
  let text = `📅 *${date}*\n`
  text += `🌤️ Le météo de Toulouse ${weather}\n`
  if (mood)     text += `${mood}\n`
  if (message)  text += `\n💬 ${message}\n`
  if (question) text += `\n❓ ${question}`
  if (req.body.music) text += `\n🎵 Musique du jour : ${req.body.music}`
  try {
    await client.sendMessage(to, text)
    if (req.file) {
      const media = MessageMedia.fromFilePath(req.file.path)
      await client.sendMessage(to, media)
      fs.unlinkSync(req.file.path)
    }
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(3000, () => console.log('🚀 打开浏览器访问 http://localhost:3000'))