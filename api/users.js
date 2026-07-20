'use strict';
// Hardcoded demo users. Production = OAuth2/OIDC; prototype = this, honestly labelled.
module.exports = [
    { username: 'supplier1', password: 'demo123', role: 'supplier',
      displayName: 'Sri Lakshmi Textiles', vrn: 'VRN123456' },
    { username: 'payer1', password: 'demo123', role: 'payer',
      displayName: 'BigRetail Ltd' },
    { username: 'lloyds', password: 'demo123', role: 'lender',
      displayName: 'Lloyds Bank' },
    { username: 'otherbank', password: 'demo123', role: 'lender',
      displayName: 'OtherBank NBFC' }   // the second lender = our demo kill shot
];
