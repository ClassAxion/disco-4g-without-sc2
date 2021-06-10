module.exports = {
    apps: [
        {
            name: 'disco-4g-without-sc2',
            script: './app.js',
            env: {
                NODE_ENV: 'development',
            },
            env_production: {
                NODE_ENV: 'production',
            },
        },
    ],
};
