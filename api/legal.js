// Términos y condiciones y aviso de privacidad: una sola versión para los dos textos (la fecha del
// texto vigente). Al cambiar cualquiera de los dos se sube la fecha y la app le vuelve a pedir la
// aceptación a cada cuenta, una vez. Los textos viven en el frontend
// (components/TermsNotice.jsx y components/PrivacyNotice.jsx).
export const LEGAL_VERSION = '2026-10-04';

export const legalAcceptedOf = user => user?.legal_version === LEGAL_VERSION;

// Lo que manda el cliente al registrarse o vincular su ficha: el check de los términos y el aviso
// (legalAccepted), o el check único de las versiones anteriores de la app (healthConsent: true),
// que incluía el aviso de privacidad. Con este último la cuenta se crea igual y los términos se
// le piden después, al entrar.
export const legalOkOf = body => body?.legalAccepted === true || body?.healthConsent === true;

// Consentimiento de salud que manda el cliente: true, false (el check opcional sin marcar) o
// undefined (no se le preguntó: queda para la pregunta de una sola vez).
export const healthChoiceOf = body => typeof body?.healthConsent === 'boolean' ? body.healthConsent : undefined;
