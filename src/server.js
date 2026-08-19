require('dotenv').config();

const path = require('path');
const express = require('express');
const connectDB = require('./config/connectDB');
const flash = require('connect-flash');
const session = require('express-session');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const { getSsoAppLinks } = require('./utils/appSwitcher');
const { fetchAccessibleApps } = require('./services/ssoAppDirectory');
const { SSO_COOKIE_NAME } = require('./utils/ssoClient');

const app = express();

// Connect to MongoDB
connectDB();

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Express body parser
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
// Static Middleware
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));
app.use('/public', express.static(publicDir));
app.use('/assets', express.static(path.join(publicDir, 'assets')));
app.use('/modernizo', express.static(path.join(publicDir, 'modernizo')));
app.use('/.well-known', express.static(path.join(publicDir, '.well-known')));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'sunjani-session',
    resave: false,
    saveUninitialized: false,
  }),
);

// Flash middleware
app.use(flash());

// Global variables middleware
app.use(function (req, res, next) {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

app.use(async function (req, res, next) {
  try {
    const token = req.cookies && req.cookies[SSO_COOKIE_NAME];
    const appsFromSso = token ? await fetchAccessibleApps({ token }) : [];
    const userApps = req.currentUser && Array.isArray(req.currentUser.applications)
      ? req.currentUser.applications
      : [];

    res.locals.ssoApps = getSsoAppLinks(req, { tokenApps: appsFromSso, userApps });
  } catch (err) {
    res.locals.ssoApps = getSsoAppLinks(req);
  }

  try {
    const base = (process.env.SSO_BASE_URL || '').replace(/\/+$/, '');
    const route = process.env.SSO_ADMIN_USERS_PATH || '/admin/users';
    res.locals.ssoAdminUsersUrl = base ? new URL(route, `${base}/`).toString() : '/admin/users';
  } catch (err) {
    res.locals.ssoAdminUsersUrl = '/admin/users';
  }

  next();
});

// Routes
app.use(methodOverride('_method'));
app.use('/users', require('./routes/users.js'));
app.use('/admin', require('./routes/admin.js'));
app.use('/restapi', require('./routes/restapi.js'));
app.use('/', require('./routes/index.js'));

// Listening PORT
const PORT = process.env.PORT || 8235;
app.listen(
  PORT,
  console.log(`Server started on port http://localhost:${PORT}`),
);
