import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Kept identical (by hand) to SECURITY_QUESTIONS in the dashboard's authService.js — this is a
// tiny static list of question text, not behavioral logic, so duplicating it across the two
// repos carries none of the drift risk that checkRequirement() did (see memory:
// compliance-logic-triplication). Validated server-side so a request can't set an arbitrary
// question string.
export const SECURITY_QUESTIONS = [
  "What is your mother's maiden name?",
  "What was the name of your first pet?",
  "What city were you born in?",
  "What was the make of your first car?",
  "What is your favorite book?",
  "What was your childhood nickname?",
];

const SALT_ROUNDS = 10;
const SESSION_EXPIRY = "12h";
const RESET_TOKEN_EXPIRY = "10m";

export function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// Answers are normalized before hashing/comparing so casing/whitespace differences at setup
// time vs. reset time don't spuriously fail a correct answer.
function normalizeAnswer(answer) {
  return String(answer ?? "")
    .trim()
    .toLowerCase();
}

export function hashAnswer(answer) {
  return bcrypt.hashSync(normalizeAnswer(answer), SALT_ROUNDS);
}

export function compareAnswer(answer, hash) {
  return bcrypt.compareSync(normalizeAnswer(answer), hash);
}

function signJwt(payload, expiresIn) {
  const { JWT_SECRET } = process.env;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password,
    securityQuestionsSet: row.security_questions_set,
  };
}

// Session token — carries everything the frontend/route guards need without a DB round-trip.
export function signSessionToken(row) {
  const user = toPublicUser(row);
  return signJwt(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      securityQuestionsSet: user.securityQuestionsSet,
    },
    SESSION_EXPIRY,
  );
}

// Short-lived, single-purpose token proving the holder answered both security questions
// correctly — required by POST /reset-password so that step can't be reached without it.
export function signPasswordResetToken(userId) {
  return signJwt({ sub: userId, purpose: "password_reset" }, RESET_TOKEN_EXPIRY);
}

export function verifyPasswordResetToken(token) {
  const { JWT_SECRET } = process.env;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.purpose !== "password_reset") {
    throw new Error("Not a password reset token");
  }
  return payload;
}

export function isValidPassword(password) {
  return typeof password === "string" && password.length >= 8;
}
