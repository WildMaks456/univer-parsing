const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());

function getWeekRange() {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const format = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    };

    return {
        monday: format(monday),
        sunday: format(sunday),
        year: monday.getFullYear(),
        month: monday.getMonth() + 1
    };
}

async function launchBrowser() {
    if (process.env.RENDER) {

        process.env.TMPDIR = "/tmp";
        process.env.TEMP = "/tmp";
        process.env.TMP = "/tmp";

        return await puppeteer.launch({
            args: [
                ...chromium.args,
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process"
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
    } else {
        return await puppeteer.launch({ headless: true });
    }
}


// async function scrapeSchedule(username, password) {
//     const browser = await puppeteer.launch({ headless: true });
//     const page = await browser.newPage();

//     await page.goto('https://univer.kstu.kz/user/login?ReturnUrl=%2f', { waitUntil: 'networkidle2' });

//     await page.type('input[type="text"]', username);
//     await page.type('input[type="password"]', password);

//     await Promise.all([
//         page.click('input[type="submit"]'),
//         page.waitForNavigation({ waitUntil: 'networkidle2' }),
//     ]);

//     await page.waitForSelector('a[href="/lang/change/ru/"]');

//     await Promise.all([
//         page.click('a[href="/lang/change/ru/"]'),
//         page.waitForNavigation({ waitUntil: 'networkidle2' })
//     ]);

//     const { monday, sunday } = getWeekRange()
//     await page.goto(`https://univer.kstu.kz/student/myschedule/2025/2/${monday}/${sunday}/`, { waitUntil: 'networkidle2' });

//     await page.waitForSelector('.schedule');

//     const schedule = await page.evaluate(() => {
//         const rows = document.querySelectorAll('.schedule tr');
//         const result = [];

//         rows.forEach(row => {
//             const cells = Array.from(row.querySelectorAll('td')).map(cell => {
//                 const groupDivs = cell.querySelectorAll('.groups > div');
//                 const cellData = Array.from(groupDivs).map(groupDiv => {
//                     const subjectElement = groupDiv.querySelector('.teacher');
//                     const teacherElement = groupDiv.querySelectorAll('.teacher')[1];
//                     const params = groupDiv.querySelectorAll('.params span');

//                     const subject = subjectElement ? subjectElement.innerText.trim() : '';
//                     const teacher = teacherElement ? teacherElement.innerText.trim() : '';
//                     const room = params.length > 0 ? Array.from(params).slice(0, 2).map(span => span.innerText.trim()).join(' ') : '';
//                     const period = params.length > 1 ? Array.from(params).slice(2).map(span => span.innerText.trim()).join(' ') : '';

//                     return { subject, teacher, room, period };
//                 });

//                 return cellData;
//             });

//             while (cells.length < 6) {
//                 cells.push([]);
//             }

//             result.push(cells.slice(1, 7));
//         });

//         return result.slice(1);
//     });

//     await browser.close();
//     return schedule;
// }

async function scrapeSchedule(username, password) {
    const browser = await launchBrowser();

    const page = await browser.newPage();

    await page.goto('https://univer.kstu.kz/user/login?ReturnUrl=%2f', { waitUntil: 'networkidle2' });

    await page.type('input[type="text"]', username);
    await page.type('input[type="password"]', password);

    await Promise.all([
        page.click('input[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);


    await page.waitForSelector('a[href="/lang/change/ru/"]');
    await Promise.all([
        page.click('a[href="/lang/change/ru/"]'),
        page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    const { monday, sunday, year, month } = getWeekRange();
    const scheduleUrl = `https://univer.kstu.kz/student/myschedule/2025/2/${monday}/${sunday}/`

    await page.goto(scheduleUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.schedule');

    const schedule = await page.evaluate(() => {
        const rows = document.querySelectorAll('.schedule tr');
        const result = [];

        rows.forEach(row => {
            const dayCells = Array.from(row.querySelectorAll('td')).slice(1, 7); 
            const rowData = [];

            dayCells.forEach(cell => {
                const groupDivs = cell.querySelectorAll('.groups > div');

                const lessons = Array.from(groupDivs).map(groupDiv => {
                    const teacherElements = groupDiv.querySelectorAll('.teacher');
                    const params = groupDiv.querySelectorAll('.params span');

                    const subject = teacherElements[0]?.innerText.trim() || '';
                    const teacher = teacherElements[1]?.innerText.trim() || '';

                    const paramsText = Array.from(params).map(p => p.innerText.trim()).join(' ');

                    let type = 'all';
                    if (/числитель/i.test(paramsText)) type = 'numerator';
                    if (/знаменатель/i.test(paramsText)) type = 'denominator';

                    const room = params.length >= 2
                        ? `${params[0]?.innerText || ''} ${params[1]?.innerText || ''}`.trim()
                        : '';

                    return {
                        subject,
                        teacher,
                        room,
                        type
                    };
                });

                rowData.push(lessons);
            });

            result.push(rowData);
        });

        return result;
    });

    await browser.close();
    return schedule;
}


app.post('/api/schedule', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    try {
        const schedule = await scrapeSchedule(username, password);
        res.json(schedule);
    } catch (error) {
        console.error('Ошибка при парсинге расписания:', error);
        res.status(500).json({ error: 'Не удалось получить расписание' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
