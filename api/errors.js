'use strict';
// Central error handling: every error leaving the API has the same JSON shape
//   { error: <human message>, code: <machine code> }   (+ fields for validation)
// Business-rule rejections keep the ledger's own message verbatim in `error` —
// the ledger text (e.g. "DUPLICATE FINANCING BLOCKED: ...") is part of the demo.
const multer = require('multer');

class ApiError extends Error {
    constructor(status, code, message, fields) {
        super(message);
        this.status = status;
        this.code = code;
        if (fields) this.fields = fields;
    }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({
            error: tooBig ? 'File too large — maximum upload size is 5 MB' : err.message,
            code: tooBig ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_ERROR'
        });
    }
    if (err instanceof ApiError) {
        const body = { error: err.message, code: err.code };
        if (err.fields) body.fields = err.fields;
        return res.status(err.status).json(body);
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Malformed JSON body', code: 'BAD_JSON' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error', code: 'INTERNAL' });
}

module.exports = { ApiError, errorHandler };
