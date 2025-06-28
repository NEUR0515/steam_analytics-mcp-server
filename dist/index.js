import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
// Rate Limiting Implementation
class RateLimiter {
    requests = [];
    maxRequests;
    windowMs;
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }
    async checkLimit() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = Math.min(...this.requests);
            const waitTime = this.windowMs - (now - oldestRequest);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.requests.push(now);
    }
}
// Steam API Client
class SteamAPIClient {
    httpClient;
    rateLimiter;
    config;
    constructor(config) {
        this.config = config;
        this.rateLimiter = new RateLimiter(config.rateLimit.requestsPerMinute, 60000);
        this.httpClient = axios.create({
            baseURL: config.baseUrl,
            timeout: 10000,
            headers: {
                'User-Agent': 'Steam-MCP-Server/1.0',
            },
        });
        // Add response interceptor for error handling
        this.httpClient.interceptors.response.use(response => response, error => {
            console.error('Steam API Error:', error.response?.data || error.message);
            throw new McpError(ErrorCode.InternalError, `Steam API request failed: ${error.message}`);
        });
    }
    async makeRequest(endpoint, params) {
        await this.rateLimiter.checkLimit();
        const response = await this.httpClient.get(endpoint, {
            params: {
                key: this.config.apiKey,
                format: 'json',
                ...params,
            },
        });
        return response.data;
    }
    async getPlayerSummary(steamId) {
        const data = await this.makeRequest('/ISteamUser/GetPlayerSummaries/v0002/', {
            steamids: steamId,
        });
        if (!data.response?.players?.length) {
            throw new McpError(ErrorCode.InvalidParams, 'Player not found');
        }
        return data.response.players[0];
    }
    async getOwnedGames(steamId, includeAppInfo = true) {
        const data = await this.makeRequest('/IPlayerService/GetOwnedGames/v0001/', {
            steamid: steamId,
            include_appinfo: includeAppInfo,
            include_played_free_games: true,
        });
        return data.response?.games || [];
    }
    async getRecentlyPlayedGames(steamId, count = 10) {
        const data = await this.makeRequest('/IPlayerService/GetRecentlyPlayedGames/v0001/', {
            steamid: steamId,
            count,
        });
        return data.response?.games || [];
    }
    async getPlayerAchievements(steamId, appId) {
        try {
            const data = await this.makeRequest('/ISteamUserStats/GetPlayerAchievements/v0001/', {
                steamid: steamId,
                appid: appId,
            });
            return data.playerstats?.achievements || [];
        }
        catch (error) {
            // Some games don't have achievements or stats are private
            console.warn(`No achievements found for app ${appId}: ${error}`);
            return [];
        }
    }
}
// Game Analytics Engine
class GameAnalytics {
    static analyzePlaytime(games) {
        const totalMinutes = games.reduce((sum, game) => sum + game.playtime_forever, 0);
        const totalHours = Math.round(totalMinutes / 60 * 100) / 100;
        const sortedByPlaytime = games
            .filter(game => game.playtime_forever > 0)
            .sort((a, b) => b.playtime_forever - a.playtime_forever);
        const topGames = sortedByPlaytime.slice(0, 10);
        const recentlyPlayed = games.filter(game => game.playtime_2weeks && game.playtime_2weeks > 0);
        return {
            totalHours,
            totalGames: games.length,
            playedGames: sortedByPlaytime.length,
            averageHoursPerGame: sortedByPlaytime.length > 0 ?
                Math.round(totalHours / sortedByPlaytime.length * 100) / 100 : 0,
            topGamesByPlaytime: topGames.map(game => ({
                name: game.name,
                hours: Math.round(game.playtime_forever / 60 * 100) / 100,
                appid: game.appid,
            })),
            recentActivity: recentlyPlayed.map(game => ({
                name: game.name,
                hoursLast2Weeks: Math.round((game.playtime_2weeks || 0) / 60 * 100) / 100,
                totalHours: Math.round(game.playtime_forever / 60 * 100) / 100,
            })),
        };
    }
    static categorizeGames(games) {
        // This would typically use Steam's genre API or a game database
        // For now, we'll do basic categorization based on game names
        const categories = {
            fps: /call of duty|counter.?strike|valorant|apex|overwatch|battlefield/i,
            mmorpg: /world of warcraft|final fantasy|elder scrolls online|guild wars/i,
            strategy: /civilization|total war|age of empires|starcraft/i,
            survival: /rust|ark|subnautica|forest|minecraft/i,
            indie: /hollow knight|celeste|hades|undertale/i,
        };
        const categorized = {};
        const uncategorized = [];
        games.forEach(game => {
            let assigned = false;
            for (const [category, pattern] of Object.entries(categories)) {
                if (pattern.test(game.name)) {
                    if (!categorized[category])
                        categorized[category] = [];
                    categorized[category].push(game);
                    assigned = true;
                    break;
                }
            }
            if (!assigned)
                uncategorized.push(game);
        });
        return { categorized, uncategorized: uncategorized.length };
    }
    static generateInsights(analysis, player) {
        const insights = [];
        insights.push(`Gaming Profile Analysis for ${player.personaname}:`);
        insights.push(`• Total gaming time: ${analysis.totalHours} hours across ${analysis.playedGames} games`);
        insights.push(`• Average time per game: ${analysis.averageHoursPerGame} hours`);
        if (analysis.topGamesByPlaytime.length > 0) {
            const topGame = analysis.topGamesByPlaytime[0];
            insights.push(`• Most played game: ${topGame.name} (${topGame.hours} hours)`);
        }
        if (analysis.recentActivity.length > 0) {
            insights.push(`• Recently active in ${analysis.recentActivity.length} games`);
        }
        return insights.join('\n');
    }
}
// Input validation functions
function validatePlayerSummaryArgs(args) {
    if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
    }
    const argsObj = args;
    if (!argsObj.steamId || typeof argsObj.steamId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'steamId must be a string');
    }
    return { steamId: argsObj.steamId };
}
function validateAnalyzeGamingHabitsArgs(args) {
    if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
    }
    const argsObj = args;
    if (!argsObj.steamId || typeof argsObj.steamId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'steamId must be a string');
    }
    return {
        steamId: argsObj.steamId,
        includeAchievements: typeof argsObj.includeAchievements === 'boolean' ? argsObj.includeAchievements : false
    };
}
function validateGameRecommendationsArgs(args) {
    if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
    }
    const argsObj = args;
    if (!argsObj.steamId || typeof argsObj.steamId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'steamId must be a string');
    }
    return {
        steamId: argsObj.steamId,
        maxRecommendations: typeof argsObj.maxRecommendations === 'number' ? argsObj.maxRecommendations : 5
    };
}
// MCP Server Implementation
class SteamMCPServer {
    server;
    steamClient;
    constructor(config) {
        // Fixed: Server constructor now takes only one argument
        this.server = new Server({
            name: 'steam-analytics-server',
            version: '1.0.0',
        });
        this.steamClient = new SteamAPIClient(config);
        this.setupToolHandlers();
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'get_player_summary',
                        description: 'Get basic Steam player profile information',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                steamId: {
                                    type: 'string',
                                    description: 'Steam ID (64-bit) of the player',
                                },
                            },
                            required: ['steamId'],
                        },
                    },
                    {
                        name: 'analyze_gaming_habits',
                        description: 'Comprehensive analysis of a player\'s gaming habits and statistics',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                steamId: {
                                    type: 'string',
                                    description: 'Steam ID (64-bit) of the player',
                                },
                                includeAchievements: {
                                    type: 'boolean',
                                    description: 'Include achievement data in analysis',
                                    default: false,
                                },
                            },
                            required: ['steamId'],
                        },
                    },
                    {
                        name: 'get_game_recommendations',
                        description: 'Generate game recommendations based on player\'s gaming history',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                steamId: {
                                    type: 'string',
                                    description: 'Steam ID (64-bit) of the player',
                                },
                                maxRecommendations: {
                                    type: 'number',
                                    description: 'Maximum number of recommendations to generate',
                                    default: 5,
                                },
                            },
                            required: ['steamId'],
                        },
                    },
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'get_player_summary':
                        const playerArgs = validatePlayerSummaryArgs(args);
                        return await this.handleGetPlayerSummary(playerArgs.steamId);
                    case 'analyze_gaming_habits':
                        const analyzeArgs = validateAnalyzeGamingHabitsArgs(args);
                        return await this.handleAnalyzeGamingHabits(analyzeArgs.steamId, analyzeArgs.includeAchievements);
                    case 'get_game_recommendations':
                        const recommendArgs = validateGameRecommendationsArgs(args);
                        return await this.handleGetGameRecommendations(recommendArgs.steamId, recommendArgs.maxRecommendations);
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
                }
            }
            catch (error) {
                if (error instanceof McpError)
                    throw error;
                throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
            }
        });
    }
    async handleGetPlayerSummary(steamId) {
        const player = await this.steamClient.getPlayerSummary(steamId);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(player, null, 2),
                },
            ],
        };
    }
    async handleAnalyzeGamingHabits(steamId, includeAchievements) {
        const [player, games] = await Promise.all([
            this.steamClient.getPlayerSummary(steamId),
            this.steamClient.getOwnedGames(steamId),
        ]);
        const analysis = GameAnalytics.analyzePlaytime(games);
        const categories = GameAnalytics.categorizeGames(games);
        const insights = GameAnalytics.generateInsights(analysis, player);
        let achievementData = null;
        if (includeAchievements && analysis.topGamesByPlaytime.length > 0) {
            // Get achievements for top 3 most played games
            const topGames = analysis.topGamesByPlaytime.slice(0, 3);
            achievementData = await Promise.all(topGames.map(async (game) => {
                const achievements = await this.steamClient.getPlayerAchievements(steamId, game.appid);
                return {
                    appid: game.appid,
                    name: game.name,
                    achievements: achievements.slice(0, 10), // Limit to prevent data overload
                };
            }));
        }
        const result = {
            player,
            analysis,
            categories,
            insights,
            ...(achievementData && { achievementData }),
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    async handleGetGameRecommendations(steamId, maxRecommendations) {
        const [player, games, recentGames] = await Promise.all([
            this.steamClient.getPlayerSummary(steamId),
            this.steamClient.getOwnedGames(steamId),
            this.steamClient.getRecentlyPlayedGames(steamId),
        ]);
        // Simple recommendation logic based on gaming patterns
        const analysis = GameAnalytics.analyzePlaytime(games);
        const categories = GameAnalytics.categorizeGames(games);
        const recommendations = this.generateRecommendations(analysis, categories, recentGames, maxRecommendations);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        player: player.personaname,
                        recommendations,
                        reasoning: this.generateRecommendationReasoning(analysis, categories),
                    }, null, 2),
                },
            ],
        };
    }
    generateRecommendations(analysis, categories, recentGames, maxRecommendations) {
        const recommendations = [];
        // Based on most played genres
        const topCategories = Object.entries(categories.categorized)
            .sort(([, a], [, b]) => b.length - a.length)
            .slice(0, 2);
        if (topCategories.length > 0) {
            recommendations.push(`More ${topCategories[0][0]} games - you've spent significant time in this genre`);
        }
        // Based on recent activity
        if (recentGames.length > 0) {
            recommendations.push(`Games similar to your recent favorites: ${recentGames[0].name}`);
        }
        // Based on playtime patterns
        if (analysis.averageHoursPerGame > 50) {
            recommendations.push('Long-form RPGs or strategy games that offer hundreds of hours of content');
        }
        else {
            recommendations.push('Shorter, story-driven games or indie titles perfect for quick sessions');
        }
        return recommendations.slice(0, maxRecommendations);
    }
    generateRecommendationReasoning(analysis, categories) {
        return `Based on ${analysis.totalHours} hours of gaming across ${analysis.playedGames} games, with preferences toward ${Object.keys(categories.categorized).join(', ')} genres.`;
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Steam Analytics MCP Server running on stdio');
    }
}
// Main execution
async function main() {
    const config = {
        apiKey: process.env.STEAM_API_KEY || '',
        baseUrl: 'https://api.steampowered.com',
        rateLimit: {
            requestsPerMinute: 100,
            burstLimit: 10,
        },
    };
    if (!config.apiKey) {
        console.error('STEAM_API_KEY environment variable is required');
        process.exit(1);
    }
    const server = new SteamMCPServer(config);
    await server.run();
}
// Handle graceful shutdown
process.on('SIGINT', () => {
    console.error('Shutting down Steam MCP Server...');
    process.exit(0);
});
main().catch(console.error);
//# sourceMappingURL=index.js.map