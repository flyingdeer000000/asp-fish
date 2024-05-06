// Copyright 2015 rain1017.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied. See the License for the specific language governing
// permissions and limitations under the License. See the AUTHORS file
// for names of contributors.

'use strict';

let _ = require('lodash');
let request = require('request');
let quick = require('quick-pomelo');
let P = quick.Promise;
let crypto = require('crypto');
let moment = require('moment-timezone');
let short = require('short-uuid');
let paramDefinConf = require('../../statics/config/development/common/paramDefinConf');
// let edge = require('edge-js');
let sttConsts = require('../../share/consts');
let USE_DLL = true;
let logger = quick.logger.getLogger('dev', __filename);


exports.listFunc = function (obj) {
    // Iterate over the object's properties
    const ret = [];
    for (let prop in obj) {
        // Check if the property value is a function
        if (typeof obj[prop] === 'function') {
            ret.push(prop);
        }
    }
    return ret;
}

exports.cryptoPass = function (password) {
    const md5 = crypto.createHash('md5');
    return md5.update(password).digest('hex');
};

exports.rateCounter = function (opts) {
    opts = opts || {};
    let perserveSeconds = opts.perserveSeconds || 3600;
    let sampleSeconds = opts.sampleSeconds || 5;

    let counts = {};
    let cleanInterval = null;

    let getCurrentSlot = function () {
        return Math.floor(Date.now() / 1000 / sampleSeconds);
    };

    let beginSlot = getCurrentSlot();

    let counter = {
        inc: function () {
            let slotNow = getCurrentSlot();
            if (!counts.hasOwnProperty(slotNow)) {
                counts[slotNow] = 0;
            }
            counts[slotNow]++;
        },

        reset: function () {
            counts = {};
            beginSlot = getCurrentSlot();
        },

        clean: function () {
            let slotNow = getCurrentSlot();
            Object.keys(counts).forEach(function (slot) {
                if (slot < slotNow - Math.floor(perserveSeconds / sampleSeconds)) {
                    delete counts[slot];
                }
            });
        },

        rate: function (lastSeconds) {
            let slotNow = getCurrentSlot();
            let total = 0;
            let startSlot = slotNow - Math.floor(lastSeconds / sampleSeconds);
            if (startSlot < beginSlot) {
                startSlot = beginSlot;
            }
            for (let slot = startSlot; slot < slotNow; slot++) {
                total += counts[slot] || 0;
            }
            return total / ((slotNow - startSlot) * sampleSeconds);
        },

        stop: function () {
            clearInterval(cleanInterval);
        },

        counts: function () {
            return counts;
        }
    };

    cleanInterval = setInterval(function () {
        counter.clean();
    }, sampleSeconds * 1000);

    return counter;
};

exports.hrtimer = function (autoStart) {
    let total = 0;
    let starttime = null;

    let timer = {
        start: function () {
            if (starttime) {
                return;
            }
            starttime = process.hrtime();
        },
        stop: function () {
            if (!starttime) {
                return;
            }
            let timedelta = process.hrtime(starttime);
            total += timedelta[0] * 1000 + timedelta[1] / 1000000;
            return total;
        },
        total: function () {
            return total; //in ms
        },
    };

    if (autoStart) {
        timer.start();
    }
    return timer;
};

exports.timeCounter = function () {
    let counts = {};

    return {
        add: function (name, time) {
            if (!counts.hasOwnProperty(name)) {
                counts[name] = [0, 0, 0, 10000, 0];
            }
            let count = counts[name];
            count[0] += time;
            count[1]++;
            count[2] = count[0] / count[1];

            if (time < count[3]) {
                count[3] = time;
            }

            if (time > count[4]) {
                count[4] = time;
            }

        },
        reset: function () {
            counts = {};
        },
        getCounts: function () {
            return counts;
        },
    };
};

exports.intCounter = function () {
    let counts = {};

    return {
        add: function (name, id) {

            if (!counts.hasOwnProperty(name)) {
                counts[name] = {};
            }
            counts[name][id] = id;

            return counts[name][id];
        },
        minus: function (name, id) {
            if (!!counts.hasOwnProperty(name)) {
                if (!!counts[name][id]) {
                    delete counts[name][id];
                }
            }
        },
        remove: function (name) {
            if (counts.hasOwnProperty(name)) {
                delete counts[name];
            }
        },
        reset: function () {
            counts = {};
        },
        getCount: function (name) {
            if (!counts.hasOwnProperty(name)) {
                return 0;
            }

            let keys = Object.keys(counts[name]);
            return keys.length;
        },
        getIds: function (name) {
            if (!counts.hasOwnProperty(name)) {
                return [];
            }

            let keys = Object.keys(counts[name]);
            return keys;
        },
        getKeys: function () {
            let keys = Object.keys(counts);
            keys = _.map(keys, (value) => {
                return value.split('$');
            });

            return keys;
        },
        makeKey: function (str1, str2) {
            return str1 + '$' + str2;
        }
    };
};

exports.bulletIndexCache = function () {
    let maps = {};
    let timers = {};
    let expireTime = 15 * 60 * 1000;
    let timerId = -1;

    return {
        start: function () {
            if (timerId != -1) {
                return;
            }

            timerId = setInterval(() => {
                let now = Date.now();
                let arr = [];

                Object.keys(timers).forEach(value => {
                    if (now - timers[value] >= expireTime) {
                        arr.push(value);
                    }
                });

                if (arr.length > 0) {
                    arr.forEach(value => {
                        delete maps[value];
                        delete timers[value];
                    })
                }
            }, 60000);
        },
        expire: function (ms) {
            expireTime = ms;
        },
        set: function (name, id, value) {
            if (!maps.hasOwnProperty(name)) {
                maps[name] = {};
            }
            maps[name][id] = value;
            timers[name] = Date.now();

            return maps[name];
        },
        get: function (name, id) {
            if (!maps.hasOwnProperty(name)) {
                return null;
            }

            return maps[name][id];
        },
        add: function (name, value) {
            maps[name] = value;
            timers[name] = Date.now();

            return maps[name];
        },
        getAll: function (name) {
            return maps[name];
        },
        remove: function (name, id) {
            if (!maps.hasOwnProperty(name)) {
                return null;
                ;
            }

            let tmp = maps[name][id];
            delete maps[name][id];
            return tmp;
        },
        removeAll: function (name) {
            if (maps.hasOwnProperty(name)) {
                delete maps[name];
                delete timers[name];
            }
        },
        reset: function () {
            maps = {};
            timers = {};

            if (timerId != -1) {
                clearInterval(timerId);
                timerId = -1;
            }
        }
    };
};

exports.prefixInteger = function (num, length) {
    return (Array(length).join('0') + num).slice(-length);
}

exports.hashDispatch = function (id, servers) {
    if (servers.length === 0) {
        return;
    }

    if (id === null || id === undefined) {
        return servers[0];
    }

    if (typeof (id) !== 'string') {
        if (!!id.sid) {
            for (let i = 0; i < servers.length; i++) {
                if (id.sid === servers[i].id) {
                    return servers[i];
                }
            }
        }

        id = String(id);
    }

    let md5 = require('crypto').createHash('md5').update(id).digest('hex');
    let hash = parseInt(md5.substr(0, 8), 16);

    return servers[hash % servers.length];
};

exports.httpPost = function (url, params) {

    return new P((resolve, reject) => {
        request({
            url: url,
            method: "POST",
            json: true,
            headers: {
                "content-type": "application/json",
            },
            body: params
        }, function (error, response, body) {

            if (!error && response.statusCode == 200) {
                resolve(body);
            } else {
                reject({error: error, response: response});
            }
        });
    })
};

exports.randProbability = {

    randomSort: function (array) {
        return array.sort(() => Math.random() - 0.5);
    },

    getRangeHit: function (min, max, check) {
        let ret = min + Math.random() * (max - min);
        return Math.floor(ret) < check;
    },

    getRand: function (obj, key, r_objRNGMethod) {
        return this.init(obj, key, r_objRNGMethod);
    },

    getFSRand: function (fs, r_objRNGMethod, getMinOdds) {
        let randomTable;
        let randomScore;
        // 依機率取賠率
        if (!getMinOdds) {
            //先抽TABLE
            randomTable = this.getRand(fs.vals, 'tabprob', r_objRNGMethod);
            randomScore = this.getRand(randomTable.tabvals, 'prob', r_objRNGMethod);
        }
        // 取最低賠率
        else {
            let probList = [];
            // 全塞入陣列
            fs.vals.forEach(val => {
                val.tabvals.forEach(prob => {
                    probList = probList.concat(prob);
                });
            });
            // 過濾0
            probList = probList.filter((a) => {
                return a.bonus > 0;
            });
            // 排序低到高
            probList = probList.sort((a, b) => a.bonus - b.bonus);
            if (probList.length > 0) randomScore = probList[0];
        }
        return randomScore;
    },

    //获取几率总和
    sum: function (key, obj) {
        let sum = 0;
        for (let i in obj) {
            sum += obj[i][key];
        }
        return sum;
    },

    //取得结果
    // init: function (obj, key) {
    //   let result = null;
    //   let sum = this.sum(key || 'prob', obj); //几率总和
    //   for (let i in obj) {
    //     let rand = parseInt(Math.random() * sum);
    //     if (rand <= obj[i][key]) {
    //       result = obj[i];
    //       break;
    //     } else {
    //       sum -= obj[i][key];
    //     }
    //   }
    //   return result;
    // }
    init: function (obj, key, r_objRNGMethod) {
        let result = null;

        let sum = this.sum(key || 'prob', obj); //几率总和
        for (let i in obj) {

            let rand;
            if (USE_DLL) {
                const num = r_objRNGMethod[sttConsts.RNGMethodIndex.Uniform]([0, 1], true);
                rand = Math.floor(num * sum);
            } else {
                rand = Math.floor(Math.random() * sum);
            }

            if (rand < obj[i][key] && obj[i][key] > 0) {
                result = obj[i];
                break;
            } else {
                sum -= obj[i][key];
            }
        }
        return result;
    },
    loadRNGDll: function (strPath) {
        let sttRNGMethodName = this.getEnumCollection(sttConsts.RNGMethodName);
        let strDllNameSpace = 'GameLogicInterface.GameLogic';
        let m_objRNGFunction = new Array(sttRNGMethodName.length);
        for (let iMethodIndex = 0; iMethodIndex < sttRNGMethodName.length; iMethodIndex++) {
            m_objRNGFunction[iMethodIndex] = this.loadRNGMethod(strPath, strDllNameSpace, sttRNGMethodName[iMethodIndex]);
        }
        m_objRNGFunction[sttConsts.RNGMethodIndex.systemInitial](0);  //初始化RNG
        return m_objRNGFunction;
    },
    loadRNGMethod: function (strRNGPath, strDllNameSpace, strRNGMethodName) {
        logger.warn("loadRNGMethod() strRNGPath = %s , strDllNameSpace = %s , strRNGMethodName = %s", strRNGPath, strDllNameSpace, strRNGMethodName);
        try {

            switch (strRNGMethodName) {
                case sttConsts.RNGMethodName.systemInitial:
                    return function () {
                        Math.random();
                        return true;
                    };
                case sttConsts.RNGMethodName.resetSeed:
                    return function () {
                        Math.random();
                        return true;
                    };
                case sttConsts.RNGMethodName.getRawData:
                    return function (num, bol) {
                        return num;
                    };
                case sttConsts.RNGMethodName.getRNGNumber:
                    return function (data, bol) {
                        let iMax = data['iMax'] || 0;
                        return Math.floor(Math.random() * iMax);
                    };
                case sttConsts.RNGMethodName.getRNGNumberRange:
                    return function (data, bol) {
                        let iMin = data['iMin'] || 0;
                        let iMax = data['iMax'] || 0;
                        let iDelta = (iMax - iMin) * Math.random();
                        return Math.floor(iMin + iDelta);
                    };
                case sttConsts.RNGMethodName.Shuffle:
                    return function (array) {
                        let currentIndex = array.length, randomIndex;

                        // While there remain elements to shuffle.
                        while (currentIndex > 0) {
                            // Pick a remaining element.
                            randomIndex = Math.floor(Math.random() * currentIndex);
                            currentIndex--;
                            // And swap it with the current element.
                            let temp = array[currentIndex];
                            array[currentIndex] = array[randomIndex];
                            array[randomIndex] = temp;
                        }
                        return array;
                    };
                case sttConsts.RNGMethodName.Uniform:
                    return function () {
                        return Math.random();
                    };
                case sttConsts.RNGMethodName.Normal:
                    return function () {
                        return Math.random();
                    };
                default:
                    throw new Error('RNGMethodName not found: ' + strRNGMethodName);
            }

            /*
            if (!!edge) {
              return edge.func({
                assemblyFile: strRNGPath + '.dll',    //Math dll path
                typeName: strDllNameSpace,    //C# namespace
                methodName: strRNGMethodName
              });
            }
             */

        } catch (err) {
            logger.error('[utils][loadRNGMethod] err: ', err);
            throw err;
        }
    },
    getEnumCollection: function (jsonObjEnum) {
        let result = [];
        for (let p in jsonObjEnum) {
            result.push(jsonObjEnum[p]);
        }
        return result;
    },
    /*========== RNG Sample Code ==========
  systemInitial
      input : null ; output : bool ; 初始化RNG
      bRet = m_objRNGFunction[sttConsts.RNGMethodName.systemInitial]();

  resetSeed
      input : null ; output : bool ; 初始化RNG Seed
      bRet = m_objRNGFunction[sttConsts.RNGMethodName.resetSeed]();

  getRawData
      input : null ; output : int ; 讀取Raw Data
      bRet = m_objRNGFunction[sttConsts.RNGMethodName.getRawData](0,true);

  getRNGNumber
      input : null ; output : int ； 讀取 0~iMax 之間數值
      let data ={iMax:10};
      iRet = m_objRNGFunction[sttConsts.RNGMethodName.getRNGNumber](data,true);

  getRNGNumberRange
      input : null ; output : int ； 讀取 iMin~iMax 之間數值
      let data ={iMin:0,iMax:100};
      iRet = m_objRNGFunction[sttConsts.RNGMethodName.getRNGNumberRange](data,true);

  Shuffle
      input : null ; output : int ; 陣列洗牌
      let data =[1,2,3,4,5,6,7,8,9,10];
      sttRet = m_objRNGFunction[sttConsts.RNGMethodName.getRNGNumberRange](data,true);
  */

};

exports.getISOTimeStr = function (ts) {
    let objDate = new Date(ts).toISOString().split('.')[0];
    let objNewDate = moment.tz(objDate, "America/Manaus").format();
    return objNewDate;
};

exports.number = {

    /**
     * 函數，加法函數，用來得到精確的加法結果
     * 説明：javascript的加法結果會有誤差，在兩個浮點數相加的時候會比較明顯。這個函數返回較為精確的加法結果。
     * 參數：arg1：第一個加數；arg2第二個加數；
     * 返回值：兩數相加的結果
     * */
    add: function (arg1, arg2) {
        try {
            arg1 = arg1.toString();
            arg2 = arg2.toString();
            let arg1Arr = arg1.split(".");
            let arg2Arr = arg2.split(".");
            let d1 = arg1Arr.length == 2 ? arg1Arr[1] : "";
            let d2 = arg2Arr.length == 2 ? arg2Arr[1] : "";
            let maxLen = Math.max(d1.length, d2.length);
            let m = Math.pow(10, maxLen);
            return Number(((arg1 * m + arg2 * m) / m).toFixed(maxLen));
        } catch (err) {
            logger.error('[utils][add][catch] err: %s, arg1: %s, arg2: ', err, arg1, arg2);
            return null;
        }
    },
    /**
     * 函數：減法函數，用來得到精確的減法結果
     * 説明：函數返回較為精確的減法結果。
     * 參數：arg1：第一個加數；arg2第二個加數；d要保留的小數位數（可以不傳此參數，如果不傳則不處理小數位數
     * 返回值：兩數相減的結果
     * */
    sub: function (arg1, arg2) {
        return this.add(arg1, -Number(arg2));
    },
    // ------------------------------------------------------------------ //
    _getDecimalLength: function (value) {
        let list = (value + '').split('.'); // ['100', '111']
        let result = 0;
        if (list[1] !== undefined && list[1].length > 0) {
            result = list[1].length;
        }
        return result; // 回傳小數點的長度'111'-> list[1].length = 3
    },
    // ------------------------------------------------------------------ //
    /**
     *減法方法
     *subtract(67, 66.9)   // => 0.1  OK
     */
    subtract: function (value1, value2) {
        let max = Math.max(this._getDecimalLength(value1), this._getDecimalLength(value2));
        let k = Math.pow(10, max);
        return (this.workMultiply(value1, k) - this.workMultiply(value2, k)) / k;
    },
    /**
     *乘法方法
     *multiply(66.9, 100) // => 6690
     */
    workMultiply: function (value1, value2) {
        let intValue1 = +(value1 + '').replace('.', '');
        let intValue2 = +(value2 + '').replace('.', '');
        let decimalLength = this._getDecimalLength(value1) + this._getDecimalLength(value2);

        let result = (intValue1 * intValue2) / Math.pow(10, decimalLength);

        return result;
    },
    /**
     * 多個數值乘法
     * */
    multiply: function (..._val) {
        let result = 1;
        while (_val.length > 0) {
            result = this.workMultiply(result, +(_val.shift()));
        }
        return result;
    },
    /**
     *除法方法
     *divide(100.599, 20.3) // => 4.955615763546798
     */
    workDivide: function (value1, value2) {
        let intValue1 = +(value1 + '').replace('.', '');
        let intValue2 = +(value2 + '').replace('.', '');
        let decimalLength = this._getDecimalLength(value2) - this._getDecimalLength(value1);

        let result = this.workMultiply((intValue1 / intValue2), Math.pow(10, decimalLength));

        return result;
    },
    divide: function (..._val) {
        let result = _val.shift();
        while (_val.length > 0) {
            result = this.workDivide(result, _val.shift());
        }
        return result;
    },
    /**
     * 解決浮點數計算問題, 存入 *1000 取出 /1000
     * @param { Number } val 0.3
     * @param { String } doWhat / or *
     */
    oneThousand: function (val, doWhat) {
        switch (doWhat) {
            case '*':
                return this.multiply(val, 1000);
            case '/':
                return this.divide(val, 1000);
            default:
                return val;
        }
    },
};

//新增短版帶日期的uuid
exports.shortid = function () {
    let str = new Date().toISOString().replace(/\..+/g, '').replace(/T/, '').replace(/\-/g, '').replace(/:/g, '');
    return str + '_' + short.generate();
}

// 轉換成美東時間
exports.timeConvert = function (time, DateFormat) {
    if (!!DateFormat) {
        return moment(time).tz(paramDefinConf.TIME_ZONE_SET).format('YYYY-MM-DD HH:mm:ss.SSS') + 'Z'; // 2020-01-15T03:12:00.061Z
    }
    return moment(time).tz(paramDefinConf.TIME_ZONE_SET).format('YYYY-MM-DD HH:mm:ss.SSS');
};

/*
timeUnit: days , hours , minutes ,seconds
*/
exports.transTime = function (time, timeDiff, timeUnit) {
    let moment_obj = (time == '') ? moment() : moment(time);
    if (timeUnit == undefined || timeUnit == '') {
        timeUnit = 'hour';
    }
    return moment_obj.tz(paramDefinConf.TIME_ZONE_SET).add(timeDiff, timeUnit).format('YYYY-MM-DD HH:mm:ss');
}

/** 取得時間格式: 0805153059 // MMDDHHmmss
 * @param { Date } time 1626777273698
 * @param { String } format month, day, hour, minute, second, milliSeconds
 */
exports.getDateTime = function (time, format) {
    let dateTime;
    if (time) {
        dateTime = new Date(time);
    } else {
        dateTime = new Date();
    }

    let month = (Array(2).join("0") + (dateTime.getMonth() + 1)).slice(-2);
    let day = (Array(2).join("0") + dateTime.getDate()).slice(-2);
    let hour = (Array(2).join("0") + dateTime.getHours()).slice(-2);
    let minute = (Array(2).join("0") + dateTime.getMinutes()).slice(-2);
    let second = (Array(2).join("0") + dateTime.getSeconds()).slice(-2);
    let milliSeconds = (Array(3).join("0") + dateTime.getMilliseconds()).slice(-3);

    // 沒有要取特別格式，回傳[月日時分秒毫秒]
    if (!format) return month + day + hour + minute + second + milliSeconds;

    // format 帶入什麼，就取到哪裡 ex. format = 'hour'; return month + day + hour;
    switch (format) {
        case 'month':
            return month;
        case 'day':
            return month + day;
        case 'hour':
            return month + day + hour;
        case 'minute':
            return month + day + hour + minute;
        case 'second':
            return month + day + hour + minute + second;
        default:
            return month + day + hour + minute + second + milliSeconds;
    }
}

exports.getWId = function (playerId, gameId, time) {
    let timeId = this.getDateTime(time);
    return playerId + gameId + timeId;
}

exports.scoreToCash = function (amt, ratio) {
    return this.number.workMultiply(amt, ratio)
}

exports.cashToScore = function (amt, ratio) {
    return this.number.workDivide(amt, ratio)
}

exports.checkENV = function (app, env) {
    let res = false;
    if (!app) return res;
    return (app.get('env') == env);
}

/*
 * 判断ipv6格式
 * @author yifangyou
 * @version gslb 2011-03-10
 * */
exports.isIPv6 = function (tmpstr) {
    //CDCD:910A:2222:5498:8475:1111:3900:2020
    let patrn = /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i;
    let r = patrn.exec(tmpstr);
    if (r) return true;

    if (tmpstr == "::") return true;

    //F:F:F::1:1 F:F:F:F:F::1 F::F:F:F:F:1格式
    patrn = /^(([0-9a-f]{1,4}:){0,6})((:[0-9a-f]{1,4}){0,6})$/i;
    r = patrn.exec(tmpstr);
    if (r) {
        let c = cLength(tmpstr);
        if (c <= 7 && c > 0) return true;
    }

    //F:F:10F::
    patrn = /^([0-9a-f]{1,4}:){1,7}:$/i;
    r = patrn.exec(tmpstr);
    if (r) return true;

    //::F:F:10F
    patrn = /^:(:[0-9a-f]{1,4}){1,7}$/i;
    r = patrn.exec(tmpstr);
    if (r) return true;

    //F:0:0:0:0:0:10.0.0.1格式
    patrn = /^([0-9a-f]{1,4}:){6}(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i;
    r = patrn.exec(tmpstr);
    if (r) {
        if (r[2] <= 255 && r[3] <= 255 && r[4] <= 255 && r[5] <= 255) return true;
    }

    //F::10.0.0.1格式
    patrn = /^([0-9a-f]{1,4}:){1,5}:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i;
    r = patrn.exec(tmpstr);
    if (r) {
        if (r[2] <= 255 && r[3] <= 255 && r[4] <= 255 && r[5] <= 255) return true;
    }

    //::10.0.0.1格式
    patrn = /^::(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i;
    r = patrn.exec(tmpstr);
    if (r) {
        if (r[1] <= 255 && r[2] <= 255 && r[3] <= 255 && r[4] <= 255) return true;
    }

    return false;
}

function cLength(str) {
    let reg = /([0-9a-f]{1,4}:)|(:[0-9a-f]{1,4})/gi;
    let temp = str.replace(reg, ' ');
    return temp.length;
}

const GAP_MAXTIME = 50;
const TIME_GAP_LOG = "%s step %s 花費： %s 豪秒";
exports.checkTimeGap = function (dt, funcName, step, gap_maxtime) {
    try {
        if (!dt) throw ('dt =' + dt);
        let curdt = Date.now();
        let gap = (curdt - dt).toFixed(2);
        // dt = curdt;
        // 沒有傳入花費時間，使用預設
        if (gap > (gap_maxtime || GAP_MAXTIME))
            logger.warn(TIME_GAP_LOG, funcName, step, gap);
        return curdt;
    } catch (err) {
        logger.error('[utils][checkTimeGap][catch] dt: %s, funcName: %s, step: %s, gap_maxtime: %s, err:', dt, funcName, step, gap_maxtime, err);
        return null;
    }
}


