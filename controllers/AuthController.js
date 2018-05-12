const express = require('express');
const createError = require('http-errors');
const db = require('../models');

const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { tknOpt, hashOpt } = require('../config/config');

const cookieOptions = {
  maxAge: 600000,
};


function getToken(userId, firstName) {
  const payload = {
    id: userId,
    name: firstName,
  };

  const options = {
    algorithm: 'RS512',
    expiresIn: tknOpt.expireTime,
  };

  return jwt.sign(payload, tknOpt.keys.private, options);
}

function userFieldsValid(body) {
  if (!body.email) {
    return createError(400, 'Email is required');
  }

  if (!body.password) {
    return createError(400, 'Password is required');
  }

  return undefined;
}

function nameFieldsValid(body) {
  if (!body.firstName) {
    return createError(400, 'firstName is required');
  }

  if (!body.lastName) {
    return createError(400, 'lastName is required');
  }

  return undefined;
}

function register(req, res, next) {
  const validationError = userFieldsValid(req.body);
  if (validationError) {
    next(validationError);
  }

  const nameValidationError = nameFieldsValid(req.body);
  if (nameValidationError) {
    next(nameValidationError);
  }

  // Check if user exists.  Create it if it does not.
  db.user.findOne({ where: { email: req.body.email.toString() } })
    .then((user) => {
      if (user) {
        return next(createError(409, 'User already exists.'));
      }
      bcrypt.hash(req.body.password, hashOpt.saltRounds)
        .then((hash) => {
          db.user.create({
            email: req.body.email,
            password: hash,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
          })
            .then((result) => {
              const token = getToken(result.globalUserId, result.firstName);

              return res.cookie('seahorse', token, cookieOptions)
                .status(200)
                .json({ auth: true, token });
            })
            .catch((err) => {
              let number = 500;
              let message = 'Internal Server Error';

              if (err.name && err.name === 'SequelizeValidationError') {
                number = 400;
                message = 'Invalid user data.';
              }

              return next({ number, message });
            });
        });

      return undefined;
    });

  return undefined;
}

function checkAuth(req, res, next) {
  const hasCookie = (req.cookies && req.cookies.seahorse);
  const hasAuthHeader = (req.headers && req.headers.authorization);

  if (!hasCookie && !hasAuthHeader) {
    return next(createError(401));
  }

  let token = '';
  if (hasCookie) {
    token = req.cookies.seahorse;
  } else {
    let authType = '';
    [authType, token] = req.headers.authorization.split(' ');
    if (authType !== 'Bearer') {
      return next(createError(401));
    }
  }

  try {
    const decode = jwt.verify(token, tknOpt.keys.public, { algorithms: 'RS512' });
    req.userInfo = decode;
  } catch (err) {
    if (err.name && err.name === 'TokenExpiredError') {
      return next(createError(401));
    }
    return next(createError(500));
  }

  return next();
}

function getAuth(req, res, next) {
  const validationError = userFieldsValid(req.body);
  if (validationError) {
    return next(validationError);
  }

  const reqEmail = req.body.email;
  const reqPassword = req.body.password;

  const search = {
    where: {
      email: reqEmail.toString(),
    },
  };

  return db.user.findOne(search)
    .then((user) => {
      const { globalUserId, password, firstName } = user.dataValues;

      bcrypt.compare(reqPassword, password)
        .then((matched) => {
          if (!matched) {
            return next({ number: 401, message: 'Not Authorized' });
          }

          const token = getToken(globalUserId, firstName);
          return res.cookie('seahorse', token, cookieOptions)
            .status(200)
            .json({ auth: true, token, firstName });
        })
        .catch(() => {
          next({ number: 500, message: 'Internal System Error' });
        });
    })
    .catch(() => next({ error: 500, message: 'Internal Server Error' }));
}

router.post('/register', register);
router.post('/login', getAuth);

module.exports = {
  register: router,
  checkAuth,
};
