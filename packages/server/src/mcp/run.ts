import path from 'node:path';
import { initDatabase } from '../db/index.js';
import { RequirementService } from '../services/requirementService.js';
import { ProjectService } from '../services/projectService.js';
import { McpServer } from './server.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve('./workspace');
const dbPath = path.join(WORKSPACE_DIR, 'bridge.db');
const db = initDatabase(dbPath);

const projectService = new ProjectService(db);
const requirementService = new RequirementService(db, WORKSPACE_DIR);

const server = new McpServer({
  db,
  projectService,
  requirementService,
});

server.startStdio();
