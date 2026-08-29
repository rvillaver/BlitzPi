/**
 * Runtime test for BlitzPI Sandbox enforcement
 * Tests actual file operation blocking
 */

import { setupSandbox } from './src/sandbox';
import { setupAudit, AuditLogger } from './src/audit';
import { BlitzConfig } from './src/config';
import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock Pi extension API
class MockPiExtension implements Partial<ExtensionAPI> {
  private listeners: Map<string, ((event: any) => void)[]> = new Map();

  on(event: string, callback: (event: any) => ToolCallEventResult | void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, data: any): ToolCallEventResult | undefined {
    const callbacks = this.listeners.get(event) || [];
    for (const callback of callbacks) {
      const result = callback(data);
      if (result) return result;
    }
    return undefined;
  }
}

describe('BlitzPI Sandbox Runtime Tests', () => {
  let mockPi: MockPiExtension;
  let auditLogger: AuditLogger;
  let tempDir: string;
  let testRunDir: string;

  beforeEach(() => {
    mockPi = new MockPiExtension();
    
    // Create temporary directories for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blitz-test-'));
    testRunDir = path.join(tempDir, 'runs', 'blitz-run-default');
    fs.mkdirSync(testRunDir, { recursive: true });

    // Setup audit
    const auditDir = path.join(tempDir, '.blitz', 'audit');
    fs.mkdirSync(auditDir, { recursive: true });
    auditLogger = setupAudit(mockPi, { path: auditDir } as any);

    // Setup sandbox
    const config: BlitzConfig = {
      sandbox: {
        enabled: true,
        run_dir: testRunDir,
      },
      audit: {
        enabled: true,
        path: auditDir,
      },
      governance: { enabled: false },
      threat_detection: { enabled: false },
      profiles: { default: 'user' },
    } as any;

    setupSandbox(mockPi as any, config, auditLogger);
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Write Operation Blocking', () => {
    test('should ALLOW write inside sandbox (run directory)', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: path.join(testRunDir, 'allowed.txt'),
          content: 'test content',
        },
      };

      const result = mockPi.emit('tool_call', event as any);
      expect(result).toBeUndefined(); // Undefined means allowed
    });

    test('should BLOCK write to /etc', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: '/etc/test-violation.txt',
          content: 'hacked',
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result).toBeDefined();
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('SANDBOX DENIED');
    });

    test('should BLOCK write to /tmp', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: '/tmp/escape.txt',
          content: 'escape attempt',
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result).toBeDefined();
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('SANDBOX DENIED');
    });

    test('should BLOCK path traversal escape attempt', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: path.join(testRunDir, '..', '..', '..', 'etc', 'passwd'),
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result).toBeDefined();
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('SANDBOX DENIED');
    });

    test('should BLOCK write to /dev', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: '/dev/null',
          content: 'test',
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result).toBeDefined();
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('SANDBOX DENIED');
    });

    test('should BLOCK read outside sandbox', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'read',
        input: {
          file_path: '/etc/passwd',
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result).toBeDefined();
      expect(result?.block).toBe(true);
    });

    test('should ALLOW read inside sandbox', () => {
      const testFile = path.join(testRunDir, 'test.txt');
      fs.writeFileSync(testFile, 'content');

      const event: Partial<ToolCallEvent> = {
        toolName: 'read',
        input: {
          file_path: testFile,
        },
      };

      const result = mockPi.emit('tool_call', event as any);
      expect(result).toBeUndefined(); // Undefined means allowed
    });
  });

  describe('Edit Operation Blocking', () => {
    test('should BLOCK edit to /etc', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'edit',
        input: {
          file_path: '/etc/config',
          old_string: 'old',
          new_string: 'new',
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result?.block).toBe(true);
    });
  });

  describe('Delete Operation Blocking', () => {
    test('should BLOCK delete outside sandbox', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'delete',
        input: {
          file_path: '/tmp/some-file.txt',
        },
      };

      const result = mockPi.emit('tool_call', event as any) as ToolCallEventResult | undefined;
      expect(result?.block).toBe(true);
    });

    test('should ALLOW delete inside sandbox', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'delete',
        input: {
          file_path: path.join(testRunDir, 'file.txt'),
        },
      };

      const result = mockPi.emit('tool_call', event as any);
      expect(result).toBeUndefined();
    });
  });

  describe('Audit Logging', () => {
    test('should log blocked operations to audit trail', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: '/etc/test.txt',
          content: 'test',
        },
      };

      mockPi.emit('tool_call', event as any);

      const auditPath = auditLogger.getPath();
      expect(fs.existsSync(auditPath)).toBe(true);
      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('file_operation');
      expect(content).toContain('/etc/test.txt');
      expect(content).toContain('false'); // allowed: false
    });

    test('should log allowed operations to audit trail', () => {
      const event: Partial<ToolCallEvent> = {
        toolName: 'write',
        input: {
          file_path: path.join(testRunDir, 'allowed.txt'),
          content: 'test',
        },
      };

      mockPi.emit('tool_call', event as any);

      const auditPath = auditLogger.getPath();
      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('file_operation');
      expect(content).toContain('true'); // allowed: true
    });
  });
});
