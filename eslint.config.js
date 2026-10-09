const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
module.exports = defineConfig([expoConfig, { ignores: ['dist/*', 'data/*', '.expo/*', 'supabase/functions/api/server.js'] }]);
