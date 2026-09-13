const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.SMS_API_URL;
delete process.env.SMS_API_KEY;
delete process.env.EMAIL_API_URL;
delete process.env.EMAIL_API_KEY;
delete process.env.EMAIL_FROM;
const otp = require('../otp');

test('SMS and email delivery are disabled by default until configured', () => {
  assert.equal(otp.smsEnabled, false);
  assert.equal(otp.emailEnabled, false);
});

test('a freshly generated OTP verifies correctly', () => {
  const code = otp.generateOtp(1, 'test-a@example.com');
  const result = otp.verifyOtp(1, 'test-a@example.com', code);
  assert.equal(result.ok, true);
});

test('an OTP is one-time use -- verifying it twice fails the second time', () => {
  const code = otp.generateOtp(1, 'test-b@example.com');
  assert.equal(otp.verifyOtp(1, 'test-b@example.com', code).ok, true);
  const second = otp.verifyOtp(1, 'test-b@example.com', code);
  assert.equal(second.ok, false);
});

test('an incorrect code is rejected without consuming the real OTP', () => {
  const code = otp.generateOtp(1, 'test-c@example.com');
  const wrong = otp.verifyOtp(1, 'test-c@example.com', '000000');
  assert.equal(wrong.ok, false);
  const right = otp.verifyOtp(1, 'test-c@example.com', code);
  assert.equal(right.ok, true, 'the correct code should still work after a wrong guess');
});

test('verifying with no OTP ever requested fails with a clear reason', () => {
  const result = otp.verifyOtp(1, 'never-requested@example.com', '123456');
  assert.equal(result.ok, false);
  assert.match(result.error, /No OTP/);
});

test('OTPs are scoped per-site -- the same identifier on two different sites has two different codes', () => {
  const codeSiteA = otp.generateOtp(1, 'shared@example.com');
  const codeSiteB = otp.generateOtp(2, 'shared@example.com');
  // verifying site A's code against site B's identifier must fail
  const wrongSite = otp.verifyOtp(2, 'shared@example.com', codeSiteA);
  assert.equal(wrongSite.ok, false);
  // but site B's own code still works
  const rightSite = otp.verifyOtp(2, 'shared@example.com', codeSiteB);
  assert.equal(rightSite.ok, true);
});

test('too many incorrect attempts locks out the OTP', () => {
  const code = otp.generateOtp(1, 'test-lockout@example.com');
  for (let i = 0; i < 5; i++) otp.verifyOtp(1, 'test-lockout@example.com', '000000');
  const result = otp.verifyOtp(1, 'test-lockout@example.com', code); // even the correct code, after too many failures
  assert.equal(result.ok, false);
  assert.match(result.error, /Too many/);
});

test('sendSms and sendEmail safely no-op (never throw) when unconfigured', async () => {
  const smsResult = await otp.sendSms('9876543210', 'test message');
  assert.equal(smsResult.ok, false);
  assert.equal(smsResult.error, 'not configured');

  const emailResult = await otp.sendEmail('test@example.com', 'subject', 'body');
  assert.equal(emailResult.ok, false);
  assert.equal(emailResult.error, 'not configured');
});
