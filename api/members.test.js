import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MEMBER_FIELDS, parseMemberFields, validateMemberFields, validateMemberProfile,
  normalizeDni, normalizePhone, normalizeEmail, maskDni, profileChangeSummary,
  formatLinkCode, canonicalLinkCode, LINK_CODE_ALPHABET
} from './members.js';

test('DNI: solo dígitos, sin ceros adelante, 6 a 9 dígitos; guarda lo ingresado', () => {
  assert.deepEqual(normalizeDni('20.123.456').value, { dni: '20.123.456', dniNorm: '20123456' });
  assert.equal(normalizeDni(' 020 123 456 ').value.dniNorm, '20123456');
  assert.equal(normalizeDni('0012345678').value.dniNorm, '12345678');
  assert.equal(normalizeDni(20123456).value.dniNorm, '20123456');
  assert.equal(normalizeDni('123456').value.dniNorm, '123456');
  assert.equal(normalizeDni('123456789').value.dniNorm, '123456789');
  assert.ok(normalizeDni('12345').error);
  assert.ok(normalizeDni('000012345').error);        // 5 dígitos una vez sacados los ceros
  assert.ok(normalizeDni('1234567890').error);
  assert.ok(normalizeDni('20123456A').error);
  assert.ok(normalizeDni('').error);
  assert.ok(normalizeDni(null).error);
});

test('DNI enmascarado: solo los últimos 3 dígitos', () => {
  assert.equal(maskDni('20123456'), '***456');
  assert.equal(maskDni(null), null);
});

test('celular: casos argentinos a +549 + área + número', () => {
  const norm = raw => normalizePhone(raw).value?.phoneNorm;
  assert.equal(norm('11 1234-5678'), '+5491112345678');
  assert.equal(norm('011 15 1234-5678'), '+5491112345678');
  assert.equal(norm('11 15 1234 5678'), '+5491112345678');
  assert.equal(norm('+54 9 11 1234-5678'), '+5491112345678');
  assert.equal(norm('+54 11 1234-5678'), '+5491112345678');        // sin el 9: es un celular igual
  assert.equal(norm('+54 9 11 15 1234-5678'), '+5491112345678');
  assert.equal(norm('0054 9 11 1234 5678'), '+5491112345678');
  assert.equal(norm('0351 15 123-4567'), '+5493511234567');
  assert.equal(norm('351 15 1234567'), '+5493511234567');
  assert.equal(norm('(0351) 123-4567'), '+5493511234567');
  assert.equal(norm('+54 9 351 123 4567'), '+5493511234567');
  assert.equal(norm('02966 15 12-3456'), '+5492966123456');          // área de 4 dígitos
  assert.equal(norm('+1 415 555 2671'), '+14155552671');             // otro país: E.164 tal cual
});

test('celular: sin normalizar se acepta con 8+ dígitos (phone_norm null); se rechaza lo demás', () => {
  assert.deepEqual(normalizePhone('1234-5678').value, { phone: '1234-5678', phoneNorm: null });   // sin área
  assert.equal(normalizePhone('15 1234-5678').value.phoneNorm, null);  // 15 sin área
  assert.equal(normalizePhone('4123 4567 89').value.phoneNorm, null);  // no hay áreas que empiecen con 4
  assert.equal(normalizePhone(' 11 1234-5678 ').value.phone, '11 1234-5678');
  assert.ok(normalizePhone('1234567').error);
  assert.ok(normalizePhone('11 1234 abcd').error);
  assert.ok(normalizePhone('').error);
  assert.ok(normalizePhone('1'.repeat(16)).error);
});

test('mail: trim + minúsculas + forma básica', () => {
  assert.equal(normalizeEmail('  Ana.Perez@Mail.COM ').value, 'ana.perez@mail.com');
  for (const bad of ['ana', 'ana@', '@mail.com', 'ana@mail', 'ana perez@mail.com', 'ana@mail.', '']) {
    assert.ok(normalizeEmail(bad).error, bad);
  }
});

test('config de campos: defaults, parcial, required implica enabled', () => {
  assert.deepEqual(parseMemberFields(null), DEFAULT_MEMBER_FIELDS);
  assert.deepEqual(parseMemberFields('{roto'), DEFAULT_MEMBER_FIELDS);
  // Un valor guardado incoherente nunca sale como obligatorio y deshabilitado.
  assert.deepEqual(parseMemberFields('{"dni":{"enabled":false,"required":true}}').dni, { enabled: false, required: false });

  const partial = validateMemberFields({ email: { required: true } });
  assert.deepEqual(partial.value.email, { enabled: true, required: true });
  assert.deepEqual(partial.value.dni, DEFAULT_MEMBER_FIELDS.dni);

  assert.ok(validateMemberFields({ dni: { enabled: false } }).error);                 // sigue required
  assert.ok(validateMemberFields({ dni: { enabled: false, required: false } }).value);
  assert.ok(validateMemberFields({ foo: { enabled: true } }).error);
  assert.ok(validateMemberFields({ dni: { enabled: 'si' } }).error);
  assert.ok(validateMemberFields({ dni: { visible: true } }).error);
  assert.ok(validateMemberFields({}).error);
  assert.ok(validateMemberFields(null).error);
});

test('perfil: obligatorios según config, deshabilitados se ignoran', () => {
  const full = { fullName: '  Ana   Pérez ', dni: '20.123.456', phone: '11 1234-5678', email: 'ANA@mail.com' };
  const ok = validateMemberProfile(full, DEFAULT_MEMBER_FIELDS);
  assert.deepEqual(ok.value, {
    fullName: 'Ana Pérez', dni: '20.123.456', dniNorm: '20123456',
    phone: '11 1234-5678', phoneNorm: '+5491112345678', email: 'ana@mail.com'
  });
  assert.equal(validateMemberProfile({ ...full, phone: '' }, DEFAULT_MEMBER_FIELDS).field, 'phone');
  assert.equal(validateMemberProfile({ ...full, dni: undefined }, DEFAULT_MEMBER_FIELDS).field, 'dni');
  assert.equal(validateMemberProfile({ ...full, email: undefined }, DEFAULT_MEMBER_FIELDS).value.email, null);
  assert.equal(validateMemberProfile({ ...full, email: 'no' }, DEFAULT_MEMBER_FIELDS).field, 'email');

  const noDni = parseMemberFields({ dni: { enabled: false, required: false } });
  const ignored = validateMemberProfile({ ...full, dni: 'basura' }, noDni);
  assert.equal(ignored.value.dniNorm, null);
  assert.equal(ignored.value.dni, null);
});

test('perfil parcial (PUT): solo cambia lo presente y chequea obligatorios sobre el resultado', () => {
  const current = validateMemberProfile({ fullName: 'Ana', dni: '20123456', phone: '11 1234-5678' }, DEFAULT_MEMBER_FIELDS).value;
  const onlyEmail = validateMemberProfile({ email: 'a@b.co' }, DEFAULT_MEMBER_FIELDS, { current, partial: true });
  assert.deepEqual(onlyEmail.changed, ['email']);
  assert.equal(onlyEmail.value.dniNorm, '20123456');
  assert.equal(validateMemberProfile({ phone: null }, DEFAULT_MEMBER_FIELDS, { current, partial: true }).field, 'phone');
  assert.deepEqual(validateMemberProfile({ dni: '20.123.456' }, DEFAULT_MEMBER_FIELDS, { current, partial: true }).changed, []);
  // Sin perfil previo, el parcial exige igual los obligatorios.
  assert.equal(validateMemberProfile({ email: 'a@b.co' }, DEFAULT_MEMBER_FIELDS, { current: null, partial: true }).field, 'full_name');
  // DNI deshabilitado: lo guardado se conserva, no se borra.
  const noDni = parseMemberFields({ dni: { enabled: false, required: false } });
  assert.equal(validateMemberProfile({ dni: '' }, noDni, { current, partial: true }).value.dniNorm, '20123456');
});

test('resumen de cambios para auditoría: sin celular ni DNI completo', () => {
  const summary = profileChangeSummary(['full_name', 'dni', 'phone'], { dniNorm: '20123456', phone: '11 1234-5678' });
  assert.equal(summary, 'nombre y apellido, DNI ***456, celular');
  assert.equal(profileChangeSummary(['dni'], { dniNorm: null }), 'DNI borrado');
});

test('código de vinculación: XXXX-XXXX sin caracteres ambiguos, tolerante al tipeo', () => {
  for (const ch of '01OIL') assert.ok(!LINK_CODE_ALPHABET.includes(ch), ch);
  let i = 0;
  const code = formatLinkCode(n => (i++ * 7) % n);
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.equal(canonicalLinkCode(code.toLowerCase().replace('-', ' ')), code);
  assert.equal(canonicalLinkCode(code.replace('-', '')), code);
  assert.equal(canonicalLinkCode('ABCD-EFG0'), null);
  assert.equal(canonicalLinkCode('ABC'), null);
  assert.equal(canonicalLinkCode(undefined), null);
});
