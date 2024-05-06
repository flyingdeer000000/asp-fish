module.exports = {
  TASK_TYPE: {'seeueveryday': 0, 'win': 1, 'playgame': 2, 'dobanker': 3, 'recharge': 4, 'bombbanker': 5},
  NOTICE_TYPE: {'task': 1, 'reward': 4, 'mail': 2, 'mt': 3},

  route: {
    client: {
      table: {
        JOIN: 'table.join',
        QUIT: 'table.quit'
      },
      game: {
        SIT_DOWN: 'game.sitDown',
        STAND_UP: 'game.standUp',
        START: 'game.start',
        END: 'game.end',
        QUIT: 'game.quit',
        UPDATE_SCENE: 'game.updateScene',

        HIT: 'game.hit',

        FIRE: 'game.fire',
        BULLET_BOMB: 'game.bulletBomb',
        COLLIDER_RESULT: 'game.colliderResult',
        SPAWN_FISHES: 'game.onSpawnFishes',
        SPAWN_GROUP: 'game.onSpawnGroup',
        SPAWN_FLOCK: 'game.onSpawnFlock',
        CHANGE_SCENE: 'game.changeScene',
        UPDATE_CANNON: 'game.updateCannon',
        UPDATE_POSITION: 'game.updatePosition',
        LOCK_TARGET: 'game.lockTarget',
        CHAT_MESSAGE: 'game.onChatMessage',
        UPDATE_BALANCE: 'game.updateBalance',
        UPDATE_WALLET: 'game.updateWallet',
        QUIT_REFUND: 'game.quitRefund',
        TREASURE_COLLECT: 'game.treasureCollect',
        LUCKY_DRAW: 'game.luckyDraw',
        EXTRA_BET: 'game.extraBet',

        COLLIDER_FAIL: 'game.colliderFail',

        BROADCAST: 'game.broadcast'
      },
      clientAction: {
        twLogin: 'connector.accountHandler.twLogin',                              // 登入請求
        onWalletAndAccountInfo: 'fishHunter.areaHandler.onWalletAndAccountInfo',  // 開啟兌換介面
        onCurrencyExchange: 'fishHunter.areaHandler.onCurrencyExchange',          // 執行兌換
        searchTable: 'fishHunter.tableHandler.searchTableAndJoin',                // 搜尋桌子
        sitDown: 'fishHunter.areaHandler.sitDown',                                // 坐下

        onUpdateCannon: 'fishHunter.areaHandler.onUpdateCannon',                  // 調整押注
        onUpdatePosition: 'fishHunter.areaHandler.onUpdatePosition',              // 更新位置
        onFire: 'fishHunterBackend.areaHandler.onFire',                           // 開火
        onCollider: 'fishHunterBackend.areaHandler.onCollider',                   // 碰撞
        getTime: 'fishHunterBackend.areaHandler.getTime',                         // 同步房間時間
        onPushChatMsg: 'fishHunter.areaHandler.onPushChatMsg',                    // 訊息、表情
        quitGame: 'fishHunter.areaHandler.quitGame',                              // 站起來
        leaveTable: 'fishHunter.tableHandler.leaveTable',                         // 離桌


        demoshow:'fishHunter.areaHandler.onBornFish',                             // demo生魚
        killfirst:'fishHunter.areaHandler.onKillFirst',                           // 一發暴頭
        noDiefirst:'fishHunter.areaHandler.onNoDiefirst',                         // 未死額外觸發
        transition:'fishHunter.areaHandler.transition',                           // 即時換場
      }
    }
  },

  GameState: {
    // LOGOUT: 'LOGOUT',   //已經登出
    FREE: 'free',       //在選桌畫面閒置中
    LEAVING: 'leaving', //正在離開遊戲桌的途中
    READY: 'ready',     //正在進入遊戲桌的途中
    PLAYING: 'playing'  //正在遊戲桌內遊玩
  },

  AreaState: {
    FREE: 'free',
    START: 'started',
    CLOSED: 'closed',
    END: 'complete',
    CANCEL: 'cancel'
  },

  AreaStage: {
    NORMAL: 'normal',
    WAIT: 'wait',
    GROUP: 'group'
  },

  GameControl: {
    PLAY_DURATION: 60000,
    SERVER_TIME_DELAY: 2000
  },

  MoleScore: {
    1: 5,
    2: 10,
    3: -5
  },

  gameTypeId: 12,

  FishState: {
    SOLO:  'solo',                    // 沒在用
    GROUP: 'group',                   // 沒在用
    TEAM:  'team',                    // 沒在用
    FLOCK: 'flock',                   // 出魚腳本用
    CHAIN: 'chain',                   // 連鎖閃電 場上同類必死（100倍以下）
    FLASH: 'flash',                   // 放射閃電 隨機找N隻必死（100倍以下）
    METEOR:'meteor',                  // 流星雨   場上全死（100倍以下）
    FLASH_SHARK:'flash_shark',        // 閃電魚   隨機找N隻必死（100倍以下）
    WAKEN: 'awaken',                  // 覺醒 以總分推算捕獲場上魚隻
    EXTRA_BET: 'extraBet',            // 額外投注
  },

  FishType: {
    NORMAL:         'Fish_0',       // 一般魚種
    RANDOM:         'Fish_1',       // 隨機賠率魚種
    BONUS:          'Fish_2',       // 獎勵遊戲魚種
    WEAPON:         'Fish_3',       // 武器魚種

    BAZOOKA:        'Fish_300',     // 機關炮
    DRILL:          'Fish_301',     // 鑽頭炮
    LASER:          'Fish_302',     // 雷射炮
    ICE:            'Fish_303',     // 冰凍炸彈
    CHAIN:          'Fish_304',     // 連鎖閃電 場上同類必死
    FLASH:          'Fish_305',     // 放射閃電 隨機找N隻必死（100倍以下）
    METEOR:         'Fish_306',     // 流星雨   場上全死（100倍以下）
    FLASH_SHARK:    'Fish_307',     // 閃電魚   隨機找N隻必死（100倍以下）
    BOMB_CRAB:      'Fish_308',     // 炸彈蟹   範圍免費碰撞
    SERIAL_BOMB_CRAB:'Fish_309',    // 連環炸彈蟹 範圍免費碰撞
    WAKEN:          'Fish_310',     // 覺醒 以總分推算捕獲場上魚隻

    ROULETTE:       'Fish_200',     // 轉盤/輪盤
    RP:             'Fish_201',     // 紅包/金龍秘寶/巨蚌珍珠
    FIVE_COLOR:     'Fish_202',     // 五彩秘寶
    GIANT_MUSSEL:   'Fish_203',     // 巨蚌秘寶
    YI_LU_FA:       'Fish_204',     // 一路發
    GOLDEN_TREASURE:'Fish_205',     // 決戰黃金成
  },


  // 記錄登入登出操作類型
  LogType: {
    IN: 'IN',
    OUT: 'OUT',
    ACTION_LOG: 'action_log',
  },

  // 記錄登入登出內容
  PlayerStateDesc: {
    LOG_IN: 'login',
    LOG_OUT: 'logout',
    KICK_OUT: 'kickout',
    NetWinUnusual:        'NetWinUnusual',          // 總輸贏異常
    ExchangeRateLimit:    'ExchangeRateLimit',      // 洗分超過上限
    ServerShutdown:       'ServerShutdown',         // 強關server
  },

  KickUserReason:{
    KickByIdleFirePlayer:           'KickByIdleFirePlayer',           // 五分鐘在魚場內閒置沒打魚的玩家
    KickByIdleLobby:                'KickByIdleLobby',                // 在選桌畫面(大廳)閒置3分鐘的玩家
    MultiLogin:                     'MultiLogin',                     // 後踢前
    BulletIdDuplicate:              'BulletIdDuplicate',              // 子彈ID重複
    WeaponNotExist:                 'WeaponNotExist',                 // 特殊武器不存在
    WeaponAliveNotEnough:           'WeaponAliveNotEnough',           // 特殊武器剩餘碰撞次數不足
    CancelBulletIdNotExist:         'CancelBulletIdNotExist',         // 取消的子彈ID不存在
    PlayerStateDoesNotSupportEvent: 'PlayerStateDoesNotSupportEvent', // 玩家狀態不支援該事件
    DelayBetAndWinReturnFaild:      'DelayBetAndWinReturnFaild',      // delay 呼叫betAndWin API回傳失敗
  },

  BroadcastType: {
    HIGH_ODDS: 'HighOdds',  // 獲得高賠率
    ACTIVITY: 'Activity',   // 活動
    JP: 'JP',               // JP
  },

  BroadcastSendTarget: {
    ALL:                       1, // 全部
    CURRENCY:                  2, // 幣別
    GAMEID:                    3, // 遊戲ID
    GAMEID_CURRENCY:           4, // 遊戲ID+幣別
  },


  // 帳號狀態
  AccountState: {
    SUSPEND:  'S',    // 停用
    FREEZE:   'F',    // 凍結
    NORMAL:   'N',    // 正常
  },

  // 數學符號
  Math: {
    ADD:      '+',    // 加
    SUB:      '-',    // 減
    MULTIPLY: '*',    // 乘
    DIVIDE:   '/',    // 除
  },

  //透過apiserver處理的分類
  APIServerPlatform: {
    gs:       'gs',       //gs自行處理
    api:      'api',      //透過apiserver存取外部api類
    gsBridge: 'gsBridge', //透過apiserver存取DB類
  },

  APIMethod: {
    lineSelection:    'lineSelection',  //Client登入選線，不會送到API Server
    authenticate:     'authenticate',   //登入驗證
    fetchBalance:     'fetchBalance',   //更新餘額
    transferIn:       'transferIn',     //將餘額由外部轉入遊戲
    transferOut:      'transferOut',    //將餘額由遊戲轉出
    commitPlayerWin:  'commitPlayerWin',//回傳玩家遊戲結果
    bet:              'bet',            //玩家下注
    win:              'win',            //玩家贏分
    betAndWin:        'betAndWin',      //玩家下注+贏分
    keepAlive:        'keepAlive',      //心跳包
    handleStuckedBalance:     'handleStuckedBalance',      // 處理卡錢
  },

  GSBridgeMethod: {
    addLogPlayerLoginout:       'addLogPlayerLoginout',     //透過apiserver寫登入登出紀錄
    addServerActionLog:         'addServerActionLog',       //透過apiserver寫Server執行紀錄
    // findCustomerByCid:          'findCustomerByCid',        //取Customer資料
    modifyCustomerCreditAsync:  'modifyCustomerCreditAsync',//即時調整MySQL餘額
    modifyCustomerStateAsync:   'modifyCustomerStateAsync', //即時調整MySQL狀態
    addWagers:                  'addWagers',                //寫MySQL母單
    checkWidExist:              'checkWidExist',            //檢查 wid 是否存在
  },

  // 錢包類型
  walletType: {
    multipleWallet:         0,                  // 多錢包
    singleWallet:           1,                  // 單錢包
    singleBetAndWin:        'betAndWin',        // 單錢包: betAndWin
    singleBetAndWinDelay:   2,                  // 後扣型單錢包: betAndWin


    // demoMultipleWallet:     99,              // 試玩多錢包
  },
  
  RNGMethodIndex:{
    systemInitial:0,
    resetSeed:1,
    getRawData:2,
    getRNGNumber:3,
    getRNGNumberRange:4,
    Shuffle:5,
    Uniform:6,
    Normal:7
  },

  RNGMethodName:{
    systemInitial:'systemInitial',
    resetSeed:'resetSeed',
    getRawData:'getRawData',
    getRNGNumber:'getRNGNumber',
    getRNGNumberRange:'getRNGNumberRange',
    Shuffle:'Shuffle',
    Uniform:'Uniform',
    Normal:'Normal'
  },

  WalletState:{
    init:'init',
    settling:'settling',
    settled:'settled'
  },

  BillType:{
    bet: 'bet',
    win: 'win',
    betWin: 'betWin',
    betThenWin: 'betThenWin',
    fetchBalance: 'fetchBalance',
  },

  demoType:{
    normal:   0,        // 正式帳號
    test:     1,        // 測試帳號
    demo:     2,        // 試玩帳號，不寫帳
  },

  MAX_ODDS: 300,        // 限定倍數上限
};
