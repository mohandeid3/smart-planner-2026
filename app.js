const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

const app = express();

// إعداد قاعدة البيانات (تلقائياً تختار PostgreSQL عند الرفع أو SQLite للتجربة المحلية)
const dbUrl = process.env.DATABASE_URL || 'sqlite:planner.sqlite';
const sequelize = new Sequelize(dbUrl, {
    logging: false,
    dialectOptions: dbUrl.includes('postgres') ? {
        ssl: { require: true, rejectUnauthorized: false }
    } : {}
});

// --- تعريف الجداول (Models) ---
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
    content: { type: DataTypes.TEXT, defaultValue: "" },
    category: DataTypes.STRING,
    monthId: { type: DataTypes.INTEGER, defaultValue: -1 },
    weekId: { type: DataTypes.INTEGER, defaultValue: -1 },
    UserId: DataTypes.INTEGER
});

// مزامنة قاعدة البيانات
sequelize.sync();

// --- الإعدادات (Middleware) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'my-super-secret-key-2026',
    resave: false,
    saveUninitialized: false
}));

// دالة حماية الصفحات (تأكد أن المستخدم مسجل دخول)
function auth(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    next();
}

const monthsNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// --- مسارات الحسابات (Auth Routes) ---

app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    try {
        const user = await User.create(req.body);
        req.session.userId = user.id;
        res.redirect('/');
    } catch (e) { res.render('register', { error: "اسم المستخدم موجود مسبقاً" }); }
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ where: { username: req.body.username, password: req.body.password } });
    if (user) {
        req.session.userId = user.id;
        res.redirect('/');
    } else { res.render('login', { error: "بيانات الدخول غير صحيحة" }); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- مسارات المشروع (Main Routes) ---

// الصفحة الرئيسية (الشهور)
app.get('/', auth, async (req, res) => {
    const note = await Note.findOne({ where: { category: 'main', UserId: req.session.userId } });
    res.render('months', { monthsNames, note: note ? note.content : "" });
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
    res.render('weeks', { mId, mName: monthsNames[mId], weeksStats, note: note ? note.content : "" });
});

// صفحة المهام اليومية
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
    res.render('tasks', { mId, wId, mName: monthsNames[mId], daysWithDates, tasks, note: note ? note.content : "" });
});

// حفظ الملاحظات
app.post('/save-note', auth, async (req, res) => {
    const { content, category, monthId, weekId } = req.body;
    let whereClause = { category, UserId: req.session.userId };
    if (monthId && monthId != -1) whereClause.monthId = monthId;
    if (weekId && weekId != -1) whereClause.weekId = weekId;

    const [note, created] = await Note.findOrCreate({ 
        where: whereClause, 
        defaults: { content, UserId: req.session.userId } 
    });
    if (!created) { note.content = content; await note.save(); }
    res.redirect('back');
});

// إضافة مهمة
app.post('/add', auth, async (req, res) => {
    await Task.create({ ...req.body, UserId: req.session.userId });
    res.redirect('back');
});

// تحديث حالة المهمة
app.post('/toggle/:id', auth, async (req, res) => {
    const task = await Task.findOne({ where: { id: req.params.id, UserId: req.session.userId } });
    if (task) { task.completed = !task.completed; await task.save(); }
    res.redirect('back');
});

// --- تشغيل السيرفر (متوافق مع Vercel) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

module.exports = app; // مهم جداً للرفع على Vercel