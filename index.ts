import TeleBot from 'telebot'

const bot = new TeleBot('916147576:AAHLLbAZOYuMvZcNs3J-ypAubLUhut0HtN0')

let banned = []
let admins = [475823381]

let uptimeS = 0
let uptimeM = 0
let uptimeH = 0
let uptimeD = 0

bot.on('text', msg => {
    if (banned.includes(msg.from.id)) return

    console.log(msg)

    const m = msg.text

    if (/ма(ма|му|ть|мы|мой|м|тер)/i.test(m)) {
        return send(msg, 'мать не трож')
    }

    if (m == "/help") {
        const text = "Все вопросы к @melod1n и @innomaxx"
        return send(msg, text)
    }

    if (m == "/build") {
        const text = "Билда нет, но вы держитесь ©"
        return send(msg, text)
    }

    if (m == "/uptime") {
        let text = ""

        uptimeS = Math.floor(process.uptime())
        uptimeM = Math.floor(uptimeS / 60)
        uptimeH = Math.floor(uptimeM / 60)
        uptimeD = Math.floor(uptimeH / 24)

        if (uptimeD > 0) text += `${uptimeD} д. `
        if (uptimeH > 0) text += `${uptimeH} ч. `
        if (uptimeM > 0) text += `${uptimeM} м. `
        if (uptimeS > 0) text += `${uptimeS} с.`

        return send(msg, text)
    }

    if (m == "/ban" || m == "/unban") {
        if (!admins.includes(msg.from.id)) {
            return send(msg, "У Вас нет доступа к данной команде")
        }

        if (msg.reply_to_message) {
            const id = msg.reply_to_message.from.id
            if (id != admins[0] && id != 916147576) {
                const ban = m == "/ban"

                if (ban) {
                    if (banned.includes(id)) return send(msg, `id${id} уже забанен`)
                    banned.push(id)
                    return send(msg, `id${id} забанен`)
                } else {
                    if (!banned.includes(id)) return send(msg, `id${id} не забанен, чтобы его можно было разбанить`)
                    banned.slice(0, banned.length - 2)
                    return send(msg, `id${id} разбанен`)
                }
            }
        }
    }
});

bot.on(/^\/ae (.+)$/, (msg, props) => {
    if (!admins.includes(msg.from.id)) {
        return send(msg, "У Вас нет доступа к данной команде")
    }

    const text = props.match[1]
    return send(msg, eval(text))
});

bot.on(/^\/say (.+)$/, (msg, props) => {
    const text = props.match[1]
    return send(msg, text)
});

function send(msg, message) {
    bot.sendMessage(msg.chat.id, message)
}


bot.start()