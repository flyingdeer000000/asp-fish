'use strict';

const C = require("../../share/constant");


exports.Format = {
    date2text: function (date) {
        if (!date) {
            date = new Date();
        }
        // const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
        return date.toISOString().replace('T', '_').replace('Z', '');
        // return formattedDate + '.' + milliseconds;
    }
}

exports.Ret = {

    sleep: function (ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    listFunc: function (obj) {
        // Iterate over the object's properties
        const ret = [];
        for (let prop in obj) {
            // Check if the property value is a function
            if (typeof obj[prop] === 'function') {
                ret.push(prop);
            }
        }
        return ret;
    },

    data: function (next, data, msg, extra) {
        const r = {
            code: C.OK,
            data: data
        };
        if (msg) {
            r.msg = msg;
        }
        if (extra) {
            r.extra = extra;
        }
        if (!next) {
            return r;
        }
        return next(null, r);
    },

    error: function (next, msg, err, code, data, from) {

        if (!err) {
            err = new Error(msg || 'Internal Error');
        }
        if (!msg) {
            msg = err ? err.message : 'Internal Error';
        }
        if (!code) {
            code = C.REFLECT[msg] || C.ERROR;
        }

        const r = {
            code: code,
            msg: msg,
            reason: msg,
            error: err.message,
            stack: err.stack,
        }
        if (data) {
            for (let k in data) {
                r[k] = data[k];
            }
        }
        if (from) {
            r.from = from;
        }
        if (!next) {
            return r;
        }
        return next(null, r);
    }
}