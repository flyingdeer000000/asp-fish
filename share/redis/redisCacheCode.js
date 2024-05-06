module.exports = {

    //存在redis裡的資料請以
    // 1.不常需要更動
    // 2.打死不會更動
    // 3.更動了也無關帳務
    // 的資料為主
    //ex: customer
    TABLE: {
        admin:          'admin',
        customer:       'customer',
    },

    SELECT: {
        DEFAULT:		0,
        adminDao:		1,
        userDao:		2,
    },

    TTL: {
        level1:         5*60,       //5min
        level2:         10*60,      //10min
    },


    TABLE: {
        admin:          'admin',
        customer:       'customer',
    },

    TABLE_KEY: {
        admin:          'AdminId',
        customer:       'Cid',
    }
}
