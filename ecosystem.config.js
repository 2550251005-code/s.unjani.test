module.exports = {
  apps: [
    {
      name: 's_unjaniv093',
      script: 'src/server.js',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 8235,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8235,
      },
    },
  ],
};
