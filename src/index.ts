import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';

// Configuration and Types
interface SteamConfig {
  apiKey: string;
  baseUrl: string;
  rateLimit: {
    requestsPerMinute: number;
    burstLimit: number;
  };
}

interface GameStats {
  appid: number;
  name: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  last_played?: number;
  achievements?: Achievement[];
  has_community_visible_stats: boolean;
}

interface Achievement {
  apiname: string;
  achieved: boolean;
  unlocktime?: number;
  name?: string;
  description?: string;
}

interface PlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  personastate: number;
  communityvisibilitystate: number;
  lastlogoff?: number;
  timecreated?: number;
  loccountrycode?: string;
}

// Tool argument interfaces
interface PlayerSummaryArgs {
  steamId: string;
}

interface AnalyzeGamingHabitsArgs {
  steamId: string;
  includeAchievements?: boolean;
}

interface GameRecommendationsArgs {
  steamId: string;
  maxRecommendations?: number;
}

// Group gaming interfaces
interface GroupCompatibilityArgs {
  steamIds: string[];
  includeDetails?: boolean;
}

interface FindCommonGamesArgs {
  steamIds: string[];
  minOwnedBy?: number;
}

interface GroupAnalysisArgs {
  steamIds: string[];
  groupSize: number;
  maxRecommendations?: number;
  includeOwned?: boolean;
  priceRange?: string;
}

// Rate Limiting Implementation
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async checkLimit(): Promise<void> {
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
  private httpClient: AxiosInstance;
  private rateLimiter: RateLimiter;
  private config: SteamConfig;

  constructor(config: SteamConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(
      config.rateLimit.requestsPerMinute,
      60000
    );
    
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000,
      headers: {
        'User-Agent': 'Steam-MCP-Server/1.0',
      },
    });

    // Add response interceptor for error handling
    this.httpClient.interceptors.response.use(
      response => response,
      error => {
        console.error('Steam API Error:', error.response?.data || error.message);
        throw new McpError(
          ErrorCode.InternalError,
          `Steam API request failed: ${error.message}`
        );
      }
    );
  }

  private async makeRequest<T>(endpoint: string, params: Record<string, any>): Promise<T> {
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

  async getPlayerSummary(steamId: string): Promise<PlayerSummary> {
    const data = await this.makeRequest<any>('/ISteamUser/GetPlayerSummaries/v0002/', {
      steamids: steamId,
    });
    
    if (!data.response?.players?.length) {
      throw new McpError(ErrorCode.InvalidParams, 'Player not found');
    }
    
    return data.response.players[0];
  }

  async getOwnedGames(steamId: string, includeAppInfo = true): Promise<GameStats[]> {
    const data = await this.makeRequest<any>('/IPlayerService/GetOwnedGames/v0001/', {
      steamid: steamId,
      include_appinfo: includeAppInfo,
      include_played_free_games: true,
    });
    
    return data.response?.games || [];
  }

  async getRecentlyPlayedGames(steamId: string, count = 10): Promise<GameStats[]> {
    const data = await this.makeRequest<any>('/IPlayerService/GetRecentlyPlayedGames/v0001/', {
      steamid: steamId,
      count,
    });
    
    return data.response?.games || [];
  }

  async getPlayerAchievements(steamId: string, appId: number): Promise<Achievement[]> {
    try {
      const data = await this.makeRequest<any>('/ISteamUserStats/GetPlayerAchievements/v0001/', {
        steamid: steamId,
        appid: appId,
      });
      
      return data.playerstats?.achievements || [];
    } catch (error) {
      // Some games don't have achievements or stats are private
      console.warn(`No achievements found for app ${appId}: ${error}`);
      return [];
    }
  }
}

// Game Analytics Engine
class GameAnalytics {
  static analyzePlaytime(games: GameStats[]): any {
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

  static categorizeGames(games: GameStats[]): any {
    // This would typically use Steam's genre API or a game database
    // For now, we'll do basic categorization based on game names
    const categories = {
      fps: /call of duty|counter.?strike|valorant|apex|overwatch|battlefield/i,
      mmorpg: /world of warcraft|final fantasy|elder scrolls online|guild wars/i,
      strategy: /civilization|total war|age of empires|starcraft/i,
      survival: /rust|ark|subnautica|forest|minecraft/i,
      indie: /hollow knight|celeste|hades|undertale/i,
    };

    const categorized: Record<string, GameStats[]> = {};
    const uncategorized: GameStats[] = [];

    games.forEach(game => {
      let assigned = false;
      for (const [category, pattern] of Object.entries(categories)) {
        if (pattern.test(game.name)) {
          if (!categorized[category]) categorized[category] = [];
          categorized[category].push(game);
          assigned = true;
          break;
        }
      }
      if (!assigned) uncategorized.push(game);
    });

    return { categorized, uncategorized: uncategorized.length };
  }

  static generateInsights(analysis: any, player: PlayerSummary): string {
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

// Group Gaming Analyzer
class GroupGamingAnalyzer {
  private steamClient: SteamAPIClient;

  constructor(steamClient: SteamAPIClient) {
    this.steamClient = steamClient;
  }

  async analyzeGroupCompatibility(steamIds: string[]) {
    const playersData = await Promise.all(
      steamIds.map(async (steamId) => {
        const [player, games] = await Promise.all([
          this.steamClient.getPlayerSummary(steamId),
          this.steamClient.getOwnedGames(steamId)
        ]);
        const analysis = GameAnalytics.analyzePlaytime(games);
        const categories = GameAnalytics.categorizeGames(games);
        return { player, games, analysis, categories };
      })
    );

    const groupProfile = this.analyzeGroupProfile(playersData);
    const compatibilityScore = this.calculateCompatibilityScore(playersData);
    
    return {
      groupProfile,
      compatibilityScore,
      players: playersData.map(p => p.player),
      individualAnalysis: playersData.map(p => ({ player: p.player, analysis: p.analysis }))
    };
  }

  async findCommonGames(steamIds: string[], minOwnedBy: number = 2) {
    const playersGames = await Promise.all(
      steamIds.map(steamId => this.steamClient.getOwnedGames(steamId))
    );

    const allGames = new Map<number, { game: GameStats, ownedBy: string[] }>();
    
    playersGames.forEach((games, playerIndex) => {
      games.forEach(game => {
        if (!allGames.has(game.appid)) {
          allGames.set(game.appid, { game, ownedBy: [] });
        }
        allGames.get(game.appid)!.ownedBy.push(steamIds[playerIndex]);
      });
    });

    const commonGames = Array.from(allGames.values())
      .filter(entry => entry.ownedBy.length >= minOwnedBy)
      .map(entry => ({
        ...entry.game,
        ownedBy: entry.ownedBy,
        totalPlaytime: playersGames.reduce((sum, games, index) => {
          if (entry.ownedBy.includes(steamIds[index])) {
            const game = games.find(g => g.appid === entry.game.appid);
            return sum + (game?.playtime_forever || 0);
          }
          return sum;
        }, 0),
        isMultiplayer: this.isMultiplayerGame(entry.game.name)
      }))
      .sort((a, b) => b.totalPlaytime - a.totalPlaytime);

    return {
      commonGames,
      groupLibraryStats: {
        totalPlayers: steamIds.length,
        commonGamesCount: commonGames.length,
        multiplayerGamesCount: commonGames.filter(g => g.isMultiplayer).length
      }
    };
  }

  async generateGroupRecommendations(steamIds: string[], groupSize: number, maxRecommendations: number = 10) {
    const playersData = await Promise.all(
      steamIds.map(async (steamId) => {
        const [player, games] = await Promise.all([
          this.steamClient.getPlayerSummary(steamId),
          this.steamClient.getOwnedGames(steamId)
        ]);
        return { player, games };
      })
    );

    const groupAnalysis = this.analyzeGroupDynamics(playersData);
    const recommendations = this.generateRecommendations(playersData, groupAnalysis, maxRecommendations);
    
    return {
      recommendations,
      groupAnalysis
    };
  }

  private analyzeGroupProfile(playersData: any[]) {
    const totalPlayers = playersData.length;
    const totalExperience = playersData.reduce((sum, p) => sum + p.analysis.totalHours, 0);
    const averageExperience = Math.round(totalExperience / totalPlayers);
    
    const allGenres = playersData.flatMap(p => Object.keys(p.categories.categorized));
    const genreCount = allGenres.reduce((acc, genre) => {
      acc[genre] = (acc[genre] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const commonGenres = Object.entries(genreCount)
      .filter(([, count]) => count >= Math.ceil(totalPlayers / 2))
      .map(([genre]) => genre);

    const groupDynamics = this.determineGroupDynamics(playersData);
    
    return {
      totalPlayers,
      averageExperience,
      commonGenres,
      groupDynamics
    };
  }

  private calculateCompatibilityScore(playersData: any[]): number {
    if (playersData.length < 2) return 0;
    
    const experienceDiff = Math.max(...playersData.map(p => p.analysis.totalHours)) - 
                          Math.min(...playersData.map(p => p.analysis.totalHours));
    const experienceScore = Math.max(0, 100 - (experienceDiff / 100));
    
    const allGenres = playersData.flatMap(p => Object.keys(p.categories.categorized));
    const uniqueGenres = new Set(allGenres).size;
    const totalGenreInstances = allGenres.length;
    const genreOverlap = totalGenreInstances > 0 ? (totalGenreInstances - uniqueGenres) / totalGenreInstances * 100 : 0;
    
    return Math.round((experienceScore * 0.4 + genreOverlap * 0.6));
  }

  private analyzeGroupDynamics(playersData: any[]) {
    const experienceLevels = playersData.map(p => {
      const totalHours = p.games.reduce((sum: number, game: GameStats) => sum + game.playtime_forever, 0) / 60;
      if (totalHours < 100) return 'casual';
      if (totalHours < 1000) return 'regular';
      return 'hardcore';
    });

    const casualCount = experienceLevels.filter(level => level === 'casual').length;
    const regularCount = experienceLevels.filter(level => level === 'regular').length;
    const hardcoreCount = experienceLevels.filter(level => level === 'hardcore').length;

    let groupType = 'mixed';
    if (casualCount === playersData.length) groupType = 'casual';
    else if (hardcoreCount === playersData.length) groupType = 'hardcore';
    else if (regularCount >= playersData.length / 2) groupType = 'regular';

    const recommendedGenres = this.getRecommendedGenres(groupType);
    
    return {
      groupType,
      experienceDistribution: { casual: casualCount, regular: regularCount, hardcore: hardcoreCount },
      recommendedGenres
    };
  }

  private generateRecommendations(playersData: any[], groupAnalysis: any, maxRecommendations: number) {
    // Simulated recommendation logic
    const baseRecommendations = [
      { name: 'Among Us', compatibilityScore: 95, price: 5, genres: ['Casual', 'Social'] },
      { name: 'Fall Guys', compatibilityScore: 90, price: 0, genres: ['Casual', 'Party'] },
      { name: 'Rocket League', compatibilityScore: 85, price: 0, genres: ['Sports', 'Competitive'] },
      { name: 'Left 4 Dead 2', compatibilityScore: 88, price: 10, genres: ['Co-op', 'Action'] },
      { name: 'Overwatch 2', compatibilityScore: 82, price: 0, genres: ['FPS', 'Competitive'] },
      { name: 'Minecraft', compatibilityScore: 92, price: 27, genres: ['Sandbox', 'Creative'] },
      { name: 'Portal 2', compatibilityScore: 89, price: 10, genres: ['Puzzle', 'Co-op'] },
      { name: 'Stardew Valley', compatibilityScore: 87, price: 15, genres: ['Simulation', 'Relaxing'] },
      { name: 'Deep Rock Galactic', compatibilityScore: 86, price: 30, genres: ['Co-op', 'FPS'] },
      { name: 'It Takes Two', compatibilityScore: 94, price: 40, genres: ['Co-op', 'Adventure'] }
    ];

    // Filter and sort based on group analysis
    const filteredRecommendations = baseRecommendations
      .filter(game => {
        if (groupAnalysis.groupType === 'casual') {
          return game.genres.some(genre => ['Casual', 'Party', 'Social'].includes(genre));
        } else if (groupAnalysis.groupType === 'hardcore') {
          return game.genres.some(genre => ['Competitive', 'FPS', 'Strategy'].includes(genre));
        }
        return true; // Include all for mixed/regular groups
      })
      .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
      .slice(0, maxRecommendations);

    return filteredRecommendations;
  }

  private determineGroupDynamics(playersData: any[]): string {
    const avgHours = playersData.reduce((sum, p) => sum + p.analysis.totalHours, 0) / playersData.length;
    
    if (avgHours < 500) return 'Casual Gaming Group';
    if (avgHours < 2000) return 'Regular Gaming Group';
    return 'Hardcore Gaming Group';
  }

  private getRecommendedGenres(groupType: string): string[] {
    switch (groupType) {
      case 'casual': return ['Party Games', 'Casual', 'Social'];
      case 'hardcore': return ['Competitive', 'Strategy', 'Complex'];
      case 'regular': return ['Co-op', 'Multiplayer', 'Adventure'];
      default: return ['Multiplayer', 'Co-op', 'Social'];
    }
  }

  private isMultiplayerGame(gameName: string): boolean {
    const multiplayerKeywords = [
      'multiplayer', 'online', 'co-op', 'versus', 'battle', 'arena', 'team',
      'among us', 'fall guys', 'rocket league', 'overwatch', 'valorant',
      'counter-strike', 'dota', 'league of legends', 'fortnite', 'apex'
    ];
    
    return multiplayerKeywords.some(keyword => 
      gameName.toLowerCase().includes(keyword)
    );
  }
}

// Input validation functions
function validatePlayerSummaryArgs(args: unknown): PlayerSummaryArgs {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
  }
  
  const argsObj = args as Record<string, unknown>;
  if (!argsObj.steamId || typeof argsObj.steamId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'steamId must be a string');
  }
  
  return { steamId: argsObj.steamId };
}

function validateAnalyzeGamingHabitsArgs(args: unknown): Required<AnalyzeGamingHabitsArgs> {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
  }
  
  const argsObj = args as Record<string, unknown>;
  if (!argsObj.steamId || typeof argsObj.steamId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'steamId must be a string');
  }
  
  return {
    steamId: argsObj.steamId,
    includeAchievements: typeof argsObj.includeAchievements === 'boolean' ? argsObj.includeAchievements : false
  };
}

function validateGameRecommendationsArgs(args: unknown): Required<GameRecommendationsArgs> {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
  }
  
  const argsObj = args as Record<string, unknown>;
  if (!argsObj.steamId || typeof argsObj.steamId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'steamId must be a string');
  }
  
  return {
    steamId: argsObj.steamId,
    maxRecommendations: typeof argsObj.maxRecommendations === 'number' ? argsObj.maxRecommendations : 5
  };
}

// Validation functions for new group gaming tools
function validateGroupCompatibilityArgs(args: unknown): Required<GroupCompatibilityArgs> {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
  }
  
  const argsObj = args as Record<string, unknown>;
  
  if (!Array.isArray(argsObj.steamIds) || argsObj.steamIds.length < 2) {
    throw new McpError(ErrorCode.InvalidParams, 'steamIds must be an array with at least 2 Steam IDs');
  }
  
  return {
    steamIds: argsObj.steamIds as string[],
    includeDetails: typeof argsObj.includeDetails === 'boolean' ? argsObj.includeDetails : false
  };
}

function validateFindCommonGamesArgs(args: unknown): Required<FindCommonGamesArgs> {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
  }
  
  const argsObj = args as Record<string, unknown>;
  
  if (!Array.isArray(argsObj.steamIds) || argsObj.steamIds.length < 2) {
    throw new McpError(ErrorCode.InvalidParams, 'steamIds must be an array with at least 2 Steam IDs');
  }
  
  return {
    steamIds: argsObj.steamIds as string[],
    minOwnedBy: typeof argsObj.minOwnedBy === 'number' ? argsObj.minOwnedBy : 2
  };
}

function validateGroupRecommendationsArgs(args: unknown): Required<GroupAnalysisArgs> {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
  }
  
  const argsObj = args as Record<string, unknown>;
  
  if (!Array.isArray(argsObj.steamIds) || argsObj.steamIds.length < 2) {
    throw new McpError(ErrorCode.InvalidParams, 'steamIds must be an array with at least 2 Steam IDs');
  }
  
  return {
    steamIds: argsObj.steamIds as string[],
    groupSize: argsObj.steamIds.length,
    maxRecommendations: typeof argsObj.maxRecommendations === 'number' ? argsObj.maxRecommendations : 10,
    includeOwned: typeof argsObj.includeOwned === 'boolean' ? argsObj.includeOwned : true,
    priceRange: typeof argsObj.priceRange === 'string' ? argsObj.priceRange as any : 'any'
  };
}

// MCP Server Implementation
class SteamMCPServer {
  private server: Server;
  private steamClient: SteamAPIClient;
  private groupAnalyzer: GroupGamingAnalyzer;

  constructor(config: SteamConfig) {
    // Fixed: Server constructor now takes only one argument
    this.server = new Server({
      name: 'steam-analytics-server',
      version: '1.0.0',
    });

    this.steamClient = new SteamAPIClient(config);
    this.groupAnalyzer = new GroupGamingAnalyzer(this.steamClient);
    this.setupToolHandlers();
  }

  private setupToolHandlers() {
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
          {
            name: 'analyze_group_compatibility',
            description: 'Analyze gaming compatibility for a group of Steam users',
            inputSchema: {
              type: 'object',
              properties: {
                steamIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of Steam IDs (64-bit) to analyze',
                  minItems: 2,
                  maxItems: 10
                },
                includeDetails: {
                  type: 'boolean',
                  description: 'Include detailed compatibility analysis',
                  default: false
                }
              },
              required: ['steamIds']
            }
          },
          {
            name: 'find_common_games',
            description: 'Find games that multiple players in a group already own',
            inputSchema: {
              type: 'object',
              properties: {
                steamIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of Steam IDs to check game libraries',
                  minItems: 2,
                  maxItems: 10
                },
                minOwnedBy: {
                  type: 'number',
                  description: 'Minimum number of players who must own the game',
                  default: 2,
                  minimum: 1
                }
              },
              required: ['steamIds']
            }
          },
          {
            name: 'generate_group_recommendations',
            description: 'Generate multiplayer game recommendations for a group',
            inputSchema: {
              type: 'object',
              properties: {
                steamIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of Steam IDs for group analysis',
                  minItems: 2,
                  maxItems: 10
                },
                maxRecommendations: {
                  type: 'number',
                  description: 'Maximum number of game recommendations',
                  default: 10,
                  minimum: 1,
                  maximum: 20
                },
                priceRange: {
                  type: 'string',
                  enum: ['free', 'under10', 'under20', 'under50', 'any'],
                  description: 'Price range filter for recommendations',
                  default: 'any'
                },
                includeOwned: {
                  type: 'boolean',
                  description: 'Include games some players already own',
                  default: true
                }
              },
              required: ['steamIds']
            }
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
            return await this.handleAnalyzeGamingHabits(
              analyzeArgs.steamId,
              analyzeArgs.includeAchievements
            );
          
          case 'get_game_recommendations':
            const recommendArgs = validateGameRecommendationsArgs(args);
            return await this.handleGetGameRecommendations(
              recommendArgs.steamId,
              recommendArgs.maxRecommendations
            );
          
          case 'analyze_group_compatibility':
            const compatibilityArgs = validateGroupCompatibilityArgs(args);
            return await this.handleAnalyzeGroupCompatibility(
              compatibilityArgs.steamIds,
              compatibilityArgs.includeDetails
            );
          
          case 'find_common_games':
            const commonGamesArgs = validateFindCommonGamesArgs(args);
            return await this.handleFindCommonGames(
              commonGamesArgs.steamIds,
              commonGamesArgs.minOwnedBy
            );
          
          case 'generate_group_recommendations':
            const recommendationsArgs = validateGroupRecommendationsArgs(args);
            return await this.handleGenerateGroupRecommendations(
              recommendationsArgs.steamIds,
              recommendationsArgs.maxRecommendations,
              recommendationsArgs.priceRange,
              recommendationsArgs.includeOwned
            );
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
      }
    });
  }

  private async handleGetPlayerSummary(steamId: string) {
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

  private async handleAnalyzeGamingHabits(steamId: string, includeAchievements: boolean) {
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
      achievementData = await Promise.all(
        topGames.map(async (game: any) => {
          const achievements = await this.steamClient.getPlayerAchievements(steamId, game.appid);
          return {
            appid: game.appid,
            name: game.name,
            achievements: achievements.slice(0, 10), // Limit to prevent data overload
          };
        })
      );
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

  private async handleGetGameRecommendations(steamId: string, maxRecommendations: number) {
    const [player, games, recentGames] = await Promise.all([
      this.steamClient.getPlayerSummary(steamId),
      this.steamClient.getOwnedGames(steamId),
      this.steamClient.getRecentlyPlayedGames(steamId),
    ]);

    // Simple recommendation logic based on gaming patterns
    const analysis = GameAnalytics.analyzePlaytime(games);
    const categories = GameAnalytics.categorizeGames(games);
    
    const recommendations = this.generateRecommendations(
      analysis,
      categories,
      recentGames,
      maxRecommendations
    );

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

  private generateRecommendations(
    analysis: any,
    categories: any,
    recentGames: GameStats[],
    maxRecommendations: number
  ): string[] {
    const recommendations = [];
    
    // Based on most played genres
    const topCategories = Object.entries(categories.categorized)
      .sort(([,a], [,b]) => (b as GameStats[]).length - (a as GameStats[]).length)
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
    } else {
      recommendations.push('Shorter, story-driven games or indie titles perfect for quick sessions');
    }

    return recommendations.slice(0, maxRecommendations);
  }

  private generateRecommendationReasoning(analysis: any, categories: any): string {
    return `Based on ${analysis.totalHours} hours of gaming across ${analysis.playedGames} games, with preferences toward ${Object.keys(categories.categorized).join(', ')} genres.`;
  }

  // Handler methods for new group gaming tools
  private async handleAnalyzeGroupCompatibility(steamIds: string[], includeDetails: boolean) {
    const analysis = await this.groupAnalyzer.analyzeGroupCompatibility(steamIds);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            groupCompatibility: analysis,
            summary: this.generateGroupSummary(analysis),
            ...(includeDetails && { detailedAnalysis: analysis })
          }, null, 2)
        }
      ]
    };
  }

  private async handleFindCommonGames(steamIds: string[], minOwnedBy: number) {
    const commonGames = await this.groupAnalyzer.findCommonGames(steamIds, minOwnedBy);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            commonGames: commonGames.commonGames.slice(0, 20), // Limit for readability
            libraryStats: commonGames.groupLibraryStats,
            multiplayerGames: commonGames.commonGames.filter(game => game.isMultiplayer),
            recommendations: this.generatePlayNowRecommendations(commonGames.commonGames)
          }, null, 2)
        }
      ]
    };
  }

  private async handleGenerateGroupRecommendations(
    steamIds: string[], 
    maxRecommendations: number,
    priceRange: string,
    includeOwned: boolean
  ) {
    const recommendations = await this.groupAnalyzer.generateGroupRecommendations(
      steamIds, 
      steamIds.length, 
      maxRecommendations
    );
    
    // Filter by price range if specified
    let filteredRecommendations = recommendations.recommendations;
    if (priceRange !== 'any') {
      filteredRecommendations = this.filterByPriceRange(recommendations.recommendations, priceRange);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            groupRecommendations: filteredRecommendations,
            groupAnalysis: recommendations.groupAnalysis,
            playNowOptions: this.identifyPlayNowOptions(filteredRecommendations),
            budgetFriendly: filteredRecommendations.filter(game => game.price < 20),
            summary: this.generateRecommendationSummary(filteredRecommendations, recommendations.groupAnalysis)
          }, null, 2)
        }
      ]
    };
  }

  // Helper methods for group analysis
  private generateGroupSummary(analysis: any): string {
    const insights = [];
    
    insights.push(`Group Analysis for ${analysis.groupProfile.totalPlayers} players:`);
    insights.push(`• Compatibility Score: ${analysis.compatibilityScore}%`);
    insights.push(`• Average Experience: ${analysis.groupProfile.averageExperience} hours`);
    insights.push(`• Common Genres: ${analysis.groupProfile.commonGenres.join(', ') || 'None identified'}`);
    insights.push(`• Group Type: ${analysis.groupProfile.groupDynamics}`);
    
    if (analysis.compatibilityScore > 80) {
      insights.push('• Recommendation: This group has excellent compatibility for multiplayer gaming');
    } else if (analysis.compatibilityScore > 60) {
      insights.push('• Recommendation: Good group chemistry - focus on games that bridge preferences');
    } else {
      insights.push('• Recommendation: Consider games with broad appeal or role diversity');
    }
    
    return insights.join('\n');
  }

  private generatePlayNowRecommendations(commonGames: any[]): string[] {
    const recommendations = [];
    
    const multiplayerGames = commonGames
      .filter(game => game.isMultiplayer)
      .sort((a, b) => b.totalPlaytime - a.totalPlaytime)
      .slice(0, 5);
    
    if (multiplayerGames.length > 0) {
      recommendations.push(`Play Now: ${multiplayerGames[0].name} (owned by ${multiplayerGames[0].ownedBy.length} players)`);
    }
    
    const coopGames = commonGames.filter(game => 
      game.name.toLowerCase().includes('co-op') || 
      game.name.toLowerCase().includes('cooperative')
    );
    
    if (coopGames.length > 0) {
      recommendations.push(`Co-op Option: ${coopGames[0].name}`);
    }
    
    return recommendations;
  }

  private identifyPlayNowOptions(recommendations: any[]): any[] {
    return recommendations
      .filter(game => {
        // Games that are easy to get into immediately
        const easyStart = game.genres.includes('Casual') || 
                         game.name.toLowerCase().includes('party') ||
                         game.compatibilityScore > 85;
        
        // Free or cheap games
        const lowBarrier = game.price < 10;
        
        return easyStart || lowBarrier;
      })
      .slice(0, 3)
      .map(game => ({
        name: game.name,
        reason: game.price === 0 ? 'Free to play' : 
                game.compatibilityScore > 85 ? 'Perfect group match' : 
                'Easy to get started',
        compatibility: game.compatibilityScore,
        price: game.price
      }));
  }

  private filterByPriceRange(recommendations: any[], priceRange: string): any[] {
    const priceFilters = {
      free: (price: number) => price === 0,
      under10: (price: number) => price < 10,
      under20: (price: number) => price < 20,
      under50: (price: number) => price < 50,
      any: () => true
    };
    
    const filter = priceFilters[priceRange as keyof typeof priceFilters] || priceFilters.any;
    return recommendations.filter(game => filter(game.price));
  }

  private generateRecommendationSummary(recommendations: any[], groupAnalysis: any): string {
    const insights = [];
    
    if (recommendations.length === 0) {
      return 'No suitable recommendations found for this group. Consider expanding search criteria.';
    }
    
    const topGame = recommendations[0];
    insights.push(`Top Recommendation: ${topGame.name} (${topGame.compatibilityScore}% match)`);
    
    const freeGames = recommendations.filter(game => game.price === 0).length;
    if (freeGames > 0) {
      insights.push(`Free Options: ${freeGames} free-to-play games available`);
    }
    
    const avgCompatibility = recommendations.reduce((sum, game) => sum + game.compatibilityScore, 0) / recommendations.length;
    insights.push(`Average Compatibility: ${Math.round(avgCompatibility)}%`);
    
    insights.push(`Group Type: ${groupAnalysis.groupType}`);
    insights.push(`Recommended Focus: ${groupAnalysis.recommendedGenres.join(', ')}`);
    
    return insights.join('\n');
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Steam Analytics MCP Server running on stdio');
  }
}

// Main execution
async function main() {
  const config: SteamConfig = {
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