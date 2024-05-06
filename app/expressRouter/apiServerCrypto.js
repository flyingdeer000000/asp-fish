const crypto = require('crypto');

let statics = {};
module.exports = statics;

/**
 * AES加密的配置
 * 1.密钥
 * 2.偏移向量
 * 3.算法模式CBC
 * 4.补全值
 */
statics.AES_conf = {
    key: '1234567887654321', //密钥
    iv: '1012132405963708', //偏移向量
}


statics.config = function (key, iv) {
    this.AES_conf.key = key;
    this.AES_conf.iv = iv;
}

/**
 * AES_128_CBC 加密
 * 128位
 * return base64
 */
statics.encryption = function (data) {
    let key = this.AES_conf.key;
    let iv = this.AES_conf.iv;

    let cipherChunks = [];

    try {
        let cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
        cipher.setAutoPadding(true);
        cipherChunks.push(cipher.update(data, 'utf8', 'base64'));
        cipherChunks.push(cipher.final('base64'));
        let b64 = cipherChunks.join('');
        return this.b64UrlSafeEncode(b64);
    } catch (err) {
        console.error('encrypt ', err);
        return null;
    }

}


/**
 * 解密
 * return utf8
 */
statics.decryption = function (data) {
    let key = this.AES_conf.key;
    let iv = this.AES_conf.iv;

    let cipherChunks = [];

    try {
        data = this.b64UrlSafeDecode(data);
        let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(true);
        cipherChunks.push(decipher.update(data, 'base64', 'utf8'));
        cipherChunks.push(decipher.final('utf8'));
        return cipherChunks.join('');
    } catch (err) {
        console.error('decrypt ', err);
        return null;
    }
}

statics.b64UrlSafeEncode = function (base64) {
    return base64.replace(/\+/g, '-') // Convert '+' to '-'
        .replace(/\//g, '_') // Convert '/' to '_'
        .replace(/=+$/, ''); // Remove ending '='
}

statics.b64UrlSafeDecode = function (base64) {
    // Add removed at end '='
    base64 += Array(5 - base64.length % 4).join('=');

    base64 = base64
        .replace(/\-/g, '+') // Convert '-' to '+'
        .replace(/\_/g, '/'); // Convert '_' to '/'

    return base64;
}

statics.makeHash = function (str) {
    let hash = crypto.createHash('md5');
    hash.update(str);
    let ret = hash.digest('hex');

    return ret.toLowerCase();
}
