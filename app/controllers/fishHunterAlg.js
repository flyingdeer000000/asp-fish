let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let utils = require('../utils/utils');
let logger = quick.logger.getLogger('connector', __filename);
let m_objRNGMethod;

let Controller = function (app) {
    let strRNGPath = null;
    if (!app || app.controllers.RNGPath)
        strRNGPath = '../lib/RNG/GameLogicInterface';
    else
        strRNGPath = './lib/RNG/GameLogicInterface';
    // strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);
}

module.exports = function (app) {
    return new Controller(app);
}

let proto = Controller.prototype;

proto.getRandomResult = function (probs) {
    let prob = utils.randProbability.getRand(probs, 'weight', m_objRNGMethod);
    if (!prob) {
        logger.error('getRandomResult missing prob ', probs);
        return false;
    }
    let prob_val = prob.val;
    prob_val = prob_val * 10000000;
    prob_val = _.round(prob_val, 0);
    let alive = utils.number.sub(10000000, prob_val);
    if (alive < 0) {
        alive = 0;
    }
    let arr = [
        {"prob": prob_val, result: 1},
        {"prob": alive, result: 0}
    ];
    let res = utils.randProbability.getRand(arr, 'prob', m_objRNGMethod);
    if (!res) {
        logger.error('getRandomResult res no prob ', probs);
        return false;
    }
    return res.result > 0;
}

proto.getBombChainResult = function (prob) {
    if (!prob) {
        return false;
    }
    prob = prob * 100000000;
    prob = _.round(prob, 0);
    let alive = utils.number.sub(100000000, prob);
    if (alive < 0) {
        alive = 0;
    }
    let arr = [
        {"prob": prob, result: 1},
        {"prob": alive, result: 0}
    ];
    let res = utils.randProbability.getRand(arr, 'prob', m_objRNGMethod);
    if (!!res) {
        return res.result > 0;
    } else {
        // logger.error('getBombChainResult no prob ',prob);
        return false;
    }
}

// proto.getChainRandomResult = function (lambda) {
//     lambda=4;
// let L=Math.exp(-lambda)
//     let P =1;
// let K =0;
//
// do{
//     K++;
//     P *=Math.random();
//
// }while(P>L)
//
// return K;
//
// }

proto.randomFishesDie = function (score, config, levels) {
    try {
        // return (Math.random() < 0.5);
        if (score < 1) {
            score = 1;
        }

        if (score > 2000) {
            score = 2000;
        }

        let ret = 1;
        let monster = this.SPMonster(score, config, levels);
        let roomMaxCost = 1000;
        ret = this.RMSystem(roomMaxCost, monster, this.PlayerLevel);

        return ret > 0;
    } catch (err) {
        logger.error('[fishHunterAlg][randomFishesDie] err: ', err);
    }
}

proto.SPMonster = function (ratio, config, levels) {
    if (!levels || levels.length) {
        levels = [0, 0.5, 1.0, 1.5, 2.0];
    }
    let factor = config.factor;
    let level = config.level;
    let monster = this.InitMonster(0, 0, 0, 0, 0, 0, factor, level, levels[0], levels[1], levels[2], levels[3], levels[4]);
    monster.MonMul = ratio;

    let newRatio = monster.Influence / (monster.MLevel * monster.MonMul);
    let newLevel = this.Approximate(newRatio);
    monster.RT = parseInt(newLevel);

    let _RMproduct = Math.pow(newLevel, 3) * newRatio;

    let RMproduct = parseInt(_RMproduct);
    let time = RMproduct;
    let arr = [1, 1, 1];

    if (arr[0] * arr[1] * arr[2] == RMproduct) {
        monster.FirstNT = arr[0];
        monster.SecondNT = arr[1];
        monster.ThirdNT = arr[2];
    }
    for (let i = 0; i < time - 1; i++) {
        arr[i % 3] += 1;
        if (arr[0] * arr[1] * arr[2] == RMproduct) {
            monster.FirstNT = arr[0];
            monster.SecondNT = arr[1];
            monster.ThirdNT = arr[2];
        }
        if (arr[0] * arr[1] * arr[2] > RMproduct) {
            let arrMultiply = utils.number.multiply(arr[0], arr[1], arr[2]);
            let a = utils.number.sub(arrMultiply, RMproduct);

            monster.FirstNT = arr[0];
            monster.SecondNT = arr[1];
            monster.ThirdNT = arr[2];

            arr[(i - 1) % 3] -= 1;
            arrMultiply = utils.number.multiply(arr[0], arr[1], arr[2]);
            let b = utils.number.sub(Math.abs(arrMultiply), Math.abs(RMproduct));
            if (b < a) {
                monster.FirstNT = arr[0];
                monster.SecondNT = arr[1];
                monster.ThirdNT = arr[2];

                break;
            }
        }
    }

    return monster;
}

proto.InitMonster = function (_MonID,
                              _MonMul,
                              _RT,
                              _FirstNT,
                              _SecondNT,
                              _ThirdNt,
                              _Influence,
                              _MLevel,
                              _level1,
                              _level2,
                              _level3,
                              _level4,
                              _level5) {

    return {
        MonID: _MonID,
        MonMul: _MonMul,
        RT: _RT,
        FirstNT: _FirstNT,
        SecondNT: _SecondNT,
        ThirdNT: _ThirdNt,
        Influence: _Influence,
        MLevel: _MLevel,
        level1: _level1,
        level2: _level2,
        level3: _level3,
        level4: _level4,
        level5: _level5
    }
}

proto.Approximate = function (a) {
    let AL_PRECISION = 100;

    for (let i = 3; i < AL_PRECISION; i++) {
        let b = i * i * i * a;

        if (parseInt(b) == b) {
            return i;
        }
    }
    return AL_PRECISION;
}

proto.PlayerLevel = function (monster, MaxGunScore) {
    //double result1 = ((double)(player->playerPutScore - (player->playerNowScore + player->playerGetScore)))/((double)(5000*MaxGunScore));
    let result1 = 0;
    let result2 = (_.random(0, 2000)) / 1000.0;
    let result = result1 + result2;
    if (result < monster.level1)
        return 0;
    else if (result >= monster.level1 && result < monster.level2)
        return 1;
    else if (result >= monster.level2 && result < monster.level3)
        return 2;
    else if (result >= monster.level3 && result < monster.level4)
        return 3;
    else if (result >= monster.level4 && result < monster.level5)
        return 4;
    else if (result >= monster.level5)
        return 5;

    return 0;
}

proto.arrSwap = function (arr, left, right) {
    let tmp = arr[left];
    arr[left] = arr[right];
    arr[right] = tmp;
}

proto.RMSystem = function (MaxGunScore, monster, playerLevelFunc) {
    // int playerRegulation = player->playerRegulation;
    //
    // if(playerRegulation == -4)return 0;
    // if (playerRegulation <= -3 && monster->MonMul >= 150)
    // {
    //     return 0;
    // }

    let ARRAY_MAX = 2048;
    let arrayA = [];
    let arrayB = [];
    let arrayC = [];

    // logger.info('monster ',monster);

    let ArrayMax = monster.RT;
    if (ArrayMax < 0 || ArrayMax >= ARRAY_MAX) return 0;

    for (let i = 0; i < ArrayMax; i++) {
        // arrayA[i]=0;
        // arrayB[i]=0;
        // arrayC[i]=0;
        arrayA.push(0);
        arrayB.push(0);
        arrayC.push(0);
    }

    let arrayAT = monster.FirstNT;
    let arrayBT = monster.SecondNT;
    let arrayCT = monster.ThirdNT;


    // logger.info('arrayAT ',arrayAT);
    // logger.info('arrayBT ',arrayBT);
    // logger.info('arrayCT ',arrayCT);

    // while(playerRegulation < 0)
    // {
    //     arrayAT --;
    //     if (arrayAT == 0)
    //         return 0;
    //     playerRegulation++;
    //     if(playerRegulation == 0)
    //         break;
    //     arrayCT --;
    //     if (arrayCT == 0)
    //         return 0;
    //     playerRegulation++;
    //     if(playerRegulation == 0)
    //         break;
    //     arrayBT --;
    //     if(arrayBT == 0)
    //         return 0;
    //     playerRegulation++;
    // }
    //
    // while (playerRegulation > 0)
    // {
    //     arrayAT ++;
    //     playerRegulation--;
    //     if (playerRegulation == 0)
    //         break;
    //     arrayCT++;
    //     playerRegulation--;
    //     if (playerRegulation == 0)
    //         break;
    //     arrayBT++;
    //     playerRegulation--;
    // }

    if (arrayAT < 0 || arrayAT >= ARRAY_MAX) return 0;
    if (arrayBT < 0 || arrayBT >= ARRAY_MAX) return 0;
    if (arrayCT < 0 || arrayCT >= ARRAY_MAX) return 0;

    for (let i = 0; i < arrayAT; i++) {
        arrayA[i] = 1;
    }

    for (let i = 0; i < arrayBT; i++) {
        arrayB[i] = 1;
    }

    for (let i = 0; i < arrayCT; i++) {
        arrayC[i] = 1;
    }

    // logger.info('arrayA ',arrayA);
    // logger.info('arrayB ',arrayB);
    // logger.info('arrayC ',arrayC);
    //
    // logger.info('============random=================')

    for (let i = 1; i < ArrayMax; i++) {
        let a = _.random(0, i);

        this.arrSwap(arrayA, i, a);
    }
    for (let i = 1; i < ArrayMax; i++) {
        let a = _.random(0, i);

        this.arrSwap(arrayB, i, a);
    }

    for (let i = 1; i < ArrayMax; i++) {
        let a = _.random(0, i);

        this.arrSwap(arrayC, a, i);
    }

    // logger.info('arrayA ',arrayA);
    // logger.info('arrayB ',arrayB);
    // logger.info('arrayC ',arrayC);

    let newarrayA = [0, 0, 0];
    let aa = _.random(0, ArrayMax - 1);
    for (let i = 0; i < 3; i++) {
        newarrayA[i] = arrayA[aa];
        aa++;
        if (aa >= ArrayMax) {
            aa = 0;
        }
    }
    let newarrayB = [0, 0, 0];
    let ab = _.random(0, ArrayMax - 1);
    for (let i = 0; i < 3; i++) {
        newarrayB[i] = arrayB[ab];
        ab++;
        if (ab >= ArrayMax) {
            ab = 0;
        }
    }

    let newarrayC = [0, 0, 0];
    let ac = _.random(0, ArrayMax - 1);
    for (let i = 0; i < 3; i++) {
        newarrayC[i] = arrayC[ac];
        ac++;
        if (ac >= ArrayMax) {
            ac = 0;
        }
    }

    //判断是否成功击杀
    let killfish = false;
    let level = playerLevelFunc(monster, MaxGunScore);

    switch (level) {
        case 0:
            break;
        case 1:
            if (newarrayA[1] == newarrayB[1] && newarrayB[1] == newarrayC[1] && newarrayA[1] != 0)
                killfish = true;
            break;
        case 2:
            if (newarrayA[1] == newarrayB[1] && newarrayB[1] == newarrayC[1] && newarrayA[1] != 0)
                killfish = true;
            if (newarrayA[0] == newarrayB[0] && newarrayB[0] == newarrayC[0] && newarrayA[0] != 0)
                killfish = true;
            break;
        case 3:
            if (newarrayA[1] == newarrayB[1] && newarrayB[1] == newarrayC[1] && newarrayA[1] != 0)
                killfish = true;
            if (newarrayA[0] == newarrayB[0] && newarrayB[0] == newarrayC[0] && newarrayA[0] != 0)
                killfish = true;
            if (newarrayA[2] == newarrayB[2] && newarrayB[2] == newarrayC[2] && newarrayA[2] != 0)
                killfish = true;
            break;
        case 4:
            if (newarrayA[1] == newarrayB[1] && newarrayB[1] == newarrayC[1] && newarrayA[1] != 0)
                killfish = true;
            if (newarrayA[0] == newarrayB[0] && newarrayB[0] == newarrayC[0] && newarrayA[0] != 0)
                killfish = true;
            if (newarrayA[2] == newarrayB[2] && newarrayB[2] == newarrayC[2] && newarrayA[2] != 0)
                killfish = true;
            if (newarrayA[0] == newarrayB[1] && newarrayB[1] == newarrayC[2] && newarrayA[0] != 0)
                killfish = true;
            break;
        case 5:
            if (newarrayA[1] == newarrayB[1] && newarrayB[1] == newarrayC[1] && newarrayA[1] != 0)
                killfish = true;
            if (newarrayA[0] == newarrayB[0] && newarrayB[0] == newarrayC[0] && newarrayA[0] != 0)
                killfish = true;
            if (newarrayA[2] == newarrayB[2] && newarrayB[2] == newarrayC[2] && newarrayA[2] != 0)
                killfish = true;
            if (newarrayA[2] == newarrayB[1] && newarrayB[1] == newarrayC[0] && newarrayA[2] != 0)
                killfish = true;
            if (newarrayA[0] == newarrayB[1] && newarrayB[1] == newarrayC[2] && newarrayA[0] != 0)
                killfish = true;
            break;
    }

    let getScore = monster.MonMul;
    // let  totalScore = player.playerNowScore + player.playerGetScore - player.playerPutScore - player.playerNowPutScore;
    // let  totalPut = player.playerPutScore + player.playerNowPutScore;

    // if (killfish && getScore >= 1000000)
    // {
    //     let oldScore = getScore;
    //     let reason = 0;
    //     let x = rand(0, 100);
    //     if (getScore > totalPut) {
    //         killfish = false;
    //         getScore = 0;
    //         reason = 1;
    //     }
    //     else if (totalScore + getScore >= 10000000) {
    //         if (x < 95)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 2;
    //         }
    //     }
    //     else if (totalScore + getScore >= 8000000) {
    //         if (x < 80)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 3;
    //         }
    //     }
    //     else if (totalScore + getScore >= 6000000) {
    //         if (x < 70)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 4;
    //         }
    //     }
    //     else if (totalScore + getScore >= 4000000) {
    //         if (x < 70)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 5;
    //         }
    //     }
    //     else if (totalScore + getScore >= 2000000) {
    //         if (x < 60)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 6;
    //         }
    //     }
    //     else if (totalScore + getScore >= 500000) {
    //         if (x < 50)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 7;
    //         }
    //     }
    //     else if (totalScore + getScore >= 0) {
    //         if (x < 20)
    //         {
    //             getScore = 0;
    //             killfish = false;
    //             reason = 8;
    //         }
    //     }
    //
    //     if (getScore == 0) {
    //     }
    // }

    // stockscore += bulletCost;


    // if (killfish) {
    //     stockscore -= getScore;
    //
    //     if (getScore >= 1000000) {
    //     }
    // }
    //
    // if (stockscore >= 600 * MaxGunScore) {
    //     stockscore = 0;
    // }

    if (killfish)
        return getScore;
    else
        return 0;


}
