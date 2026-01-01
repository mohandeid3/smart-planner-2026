const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const sequelize = new Sequelize({ dialect: 'sqlite', storage: 'planner.sqlite', logging: false });

// تعريف الجداول
const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false }
});

const Task = sequelize.define('Task', {
    text: DataTypes.STRING,
    completed: { type: DataTypes.BOOLEAN, defaultValue: false },
    day: DataTypes.STRING,
    weekInMonth: DataTypes.INTEGER,
    month: DataTypes.INTEGER,
    UserId: DataTypes.INTEGER
});

const Note = sequelize.define('Note', {
    content: DataTypes.TEXT,
    category: DataTypes.STRING,
    monthId: { type: DataTypes.INTEGER, defaultValue: -1 },
    weekId: { type: DataTypes.INTEGER, defaultValue: -1 },
    UserId: DataTypes.INTEGER
});

sequelize.sync();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'planner-secret-2026',
    resave: false,
    saveUninitialized: true
}));

// حماية المسارات
function auth(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    next();
}

const monthsNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// مسارات الحسابات
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    try {
        const user = await User.create(req.body);
        req.session.userId = user.id;
        res.redirect('/');
    } catch (e) { res.render('register', { error: "الاسم موجود فعلاً" }); }
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ where: { username: req.body.username, password: req.body.password } });
    if (user) {
        req.session.userId = user.id;
        res.redirect('/');
    } else { res.render('login', { error: "بيانات غلط" }); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// الصفحة الرئيسية (الشهور)
app.get('/', auth, async (req, res) => {
    const note = await Note.findOne({ where: { category: 'main', UserId: req.session.userId } });
    // هنا بنحل مشكلة note is not defined بإننا نبعت قيمة فاضية لو مفيش نوتة
    res.render('months', { monthsNames, note: note ? note.content : '' });
});

// صفحة الأسابيع
app.get('/month/:mId', auth, async (req, res) => {
    const mId = parseInt(req.params.mId);
    let weeksStats = [];
    for (let w = 1; w <= 5; w++) {
        const total = await Task.count({ where: { month: mId, weekInMonth: w, UserId: req.session.userId } });
        const done = await Task.count({ where: { month: mId, weekInMonth: w, completed: true, UserId: req.session.userId } });
        weeksStats.push({ id: w, progress: total > 0 ? Math.round((done / total) * 100) : 0 });
    }
    const note = await Note.findOne({ where: { category: 'month', monthId: mId, UserId: req.session.userId } });
    res.render('weeks', { mId, mName: monthsNames[mId], weeksStats, note: note ? note.content : '' });
});

// صفحة المهام (اليومية)
app.get('/month/:mId/week/:wId', auth, async (req, res) => {
    const { mId, wId } = req.params;
    const daysNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const tasks = await Task.findAll({ where: { month: mId, weekInMonth: wId, UserId: req.session.userId } });
    
    let startDayOffset = (parseInt(wId) - 1) * 7;
    let daysWithDates = daysNames.map((name, index) => {
        let date = new Date(2026, mId, 1 + startDayOffset + index);
        return { name, dateStr: `${date.getDate()}/${date.getMonth() + 1}` };
    });

    const note = await Note.findOne({ where: { category: 'week', monthId: mId, weekId: wId, UserId: req.session.userId } });
    res.render('tasks', { mId, wId, mName: monthsNames[mId], daysWithDates, tasks, note: note ? note.content : '' });
});

app.post('/save-note', auth, async (req, res) => {
    const { content, category, monthId, weekId } = req.body;
    let where = { category, UserId: req.session.userId };
    if (monthId && monthId != -1) where.monthId = monthId;
    if (weekId && weekId != -1) where.weekId = weekId;

    const [note, created] = await Note.findOrCreate({ where, defaults: { content, UserId: req.session.userId } });
    if (!created) { note.content = content; await note.save(); }
    res.redirect('back');
});

app.post('/add', auth, async (req, res) => {
    await Task.create({ ...req.body, UserId: req.session.userId });
    res.redirect('back');
});

app.post('/toggle/:id', auth, async (req, res) => {
    const task = await Task.findOne({ where: { id: req.params.id, UserId: req.session.userId } });
    if (task) { task.completed = !task.completed; await task.save(); }
    res.redirect('back');
});

app.listen(3000, () => console.log("الموقع شغال: http://localhost:3000"));