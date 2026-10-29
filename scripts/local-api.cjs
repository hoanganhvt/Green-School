'use strict';
// Fixed loopback endpoints: these helpers cannot connect to a Google project.
const namespace = 'demo-green-school-default-rtdb';
const database = `http://127.0.0.1:9000`;
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`);
  return value;
}
function db(path = '', method = 'GET', value, token) {
  return jsonRequest(`${database}/${path}.json?ns=${namespace}${token && token !== 'owner' ? `&auth=${encodeURIComponent(token)}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token === 'owner' ? { Authorization: 'Bearer owner' } : {}) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) })
  });
}
function account(action, email, password) {
  return jsonRequest(`${auth}/accounts:${action}?key=demo-green-school-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
}
module.exports = { db, account };
