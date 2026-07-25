import assert from 'node:assert/strict';
import { extractSsnDob, summarizePrivateIdentity } from '../lib/private-fields/extract-ssn-dob.js';

const sample = `LO: What is your social security number?
Borrower: It's 123-45-6789
LO: And date of birth?
Borrower: 03/15/1985`;

const result = extractSsnDob(sample);
assert.equal(result.ssn.state, 'verified');
assert.equal(result.shapeWrite.ssn, '123-45-6789');
assert.equal(result.dob.state, 'verified');
assert.ok(result.shapeWrite.dob.includes('03/15/1985'));

const lastFour = extractSsnDob('Borrower: last four of my social is 4 5 6 7');
assert.equal(lastFour.ssn.state, 'needs_verification');
assert.equal(lastFour.ssn.last_four, '4567');
assert.equal(lastFour.shapeWrite.ssn, undefined);

const audit = summarizePrivateIdentity(result);
assert.equal(audit.ssn.has_full, true);
assert.ok(!JSON.stringify(audit).includes('123-45-6789'));

console.log('extract-ssn-dob: ok');
