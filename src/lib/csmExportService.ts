import { CSMClient, CSMXMLParser } from './csmClient';

export interface ExportConfig {
  // Connection settings
  ipAddress: string;
  username: string;
  password: string;
  verifyTls: boolean;
  
  // Export selection
  networkObjects: boolean;
  serviceObjects: boolean;
  accessLists: boolean;
  aclSource: 'policy' | 'cli';
  policyName?: string;
  deviceGid?: string;
  deviceIp?: string;
  cliCommand?: string;
  
  // Export settings
  format: 'xml' | 'json' | 'csv';
  batchSize: number;
  maxRetries: number;
  timeout: number;
  parallel: boolean;
  
  // Filtering and scoping
  filters?: {
    devices?: string[];
    domains?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
    policyAreas?: string[];
  };
}

export interface ExportResult {
  success: boolean;
  timestamp: Date;
  duration: number;
  
  // Data counts
  networkObjectsCount: number;
  serviceObjectsCount: number;
  accessRulesCount: number;
  
  // Export artifacts
  artifacts: {
    rawData: string;
    transformedData: string;
    checksum: string;
    format: string;
  };
  
  // Quality metrics
  consistencyChecks: {
    completeness: boolean;
    references: boolean;
    encoding: boolean;
    duplicates: number;
    errors: string[];
    warnings: string[];
  };
  
  // Errors and logs
  errors: ExportError[];
  logs: ExportLog[];
}

export interface ExportError {
  type: 'authentication' | 'network' | 'schema' | 'api' | 'timeout' | 'validation';
  message: string;
  details?: string;
  timestamp: Date;
  retryable: boolean;
}

export interface ExportLog {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  details?: string;
  timestamp: Date;
  correlationId: string;
  operationId: string;
}

export class CSMExportService {
  private client: CSMClient;
  private correlationId: string;
  
  constructor() {
    this.client = new CSMClient();
    this.correlationId = this.generateCorrelationId();
  }
  
  private generateCorrelationId(): string {
    return `export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private generateOperationId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }
  
  private log(level: ExportLog['level'], message: string, details?: string): ExportLog {
    const log: ExportLog = {
      level,
      message,
      details,
      timestamp: new Date(),
      correlationId: this.correlationId,
      operationId: this.generateOperationId()
    };
    console.log(`[${log.level.toUpperCase()}] ${log.message}`, log.details || '');
    return log;
  }
  
  private async retry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    operationName: string
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        if (attempt <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
          this.log('warn', `${operationName} failed, retry ${attempt}/${maxRetries} in ${delay}ms`, error.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError!;
  }
  
  private calculateChecksum(data: string): string {
    // Simple checksum implementation
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
  
  private validateData(data: any[], type: string): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check for empty names
    const emptyNames = data.filter(item => !item.name || item.name.trim() === '');
    if (emptyNames.length > 0) {
      errors.push(`${emptyNames.length} ${type} objects have empty names`);
    }
    
    // Check for duplicates
    const names = data.map(item => item.name).filter(Boolean);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      warnings.push(`${duplicates.length} duplicate ${type} object names found`);
    }
    
    // Check for special characters that might cause issues
    const specialChars = /[<>&"']/;
    const problematicNames = data.filter(item => item.name && specialChars.test(item.name));
    if (problematicNames.length > 0) {
      warnings.push(`${problematicNames.length} ${type} objects contain special characters`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  private formatData(data: any, format: 'xml' | 'json' | 'csv'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      
      case 'csv':
        return this.convertToCSV(data);
      
      case 'xml':
      default:
        return this.convertToXML(data);
    }
  }
  
  private convertToCSV(data: any): string {
    const lines: string[] = [];
    
    // Network Objects
    if (data.networkObjects && data.networkObjects.length > 0) {
      lines.push('# Network Objects');
      lines.push('Name,Type,Value,Description');
      data.networkObjects.forEach((obj: any) => {
        const row = [
          this.escapeCSV(obj.name || ''),
          this.escapeCSV(obj.type || ''),
          this.escapeCSV(obj.value || ''),
          this.escapeCSV(obj.description || '')
        ].join(',');
        lines.push(row);
      });
      lines.push('');
    }
    
    // Service Objects
    if (data.serviceObjects && data.serviceObjects.length > 0) {
      lines.push('# Service Objects');
      lines.push('Name,Protocol,Ports,Description');
      data.serviceObjects.forEach((obj: any) => {
        const row = [
          this.escapeCSV(obj.name || ''),
          this.escapeCSV(obj.protocol || ''),
          this.escapeCSV(obj.ports || ''),
          this.escapeCSV(obj.description || '')
        ].join(',');
        lines.push(row);
      });
      lines.push('');
    }
    
    // Access Rules
    if (data.accessRules && data.accessRules.length > 0) {
      lines.push('# Access Rules');
      lines.push('Policy,Position,Name,Source,Destination,Services,Action,Disabled,Logging');
      data.accessRules.forEach((rule: any) => {
        const row = [
          this.escapeCSV(rule.policy || ''),
          rule.position || '',
          this.escapeCSV(rule.name || ''),
          this.escapeCSV(Array.isArray(rule.source) ? rule.source.join(';') : rule.source || ''),
          this.escapeCSV(Array.isArray(rule.destination) ? rule.destination.join(';') : rule.destination || ''),
          this.escapeCSV(Array.isArray(rule.services) ? rule.services.join(';') : rule.services || ''),
          this.escapeCSV(rule.action || ''),
          rule.disabled || false,
          this.escapeCSV(rule.logging || '')
        ].join(',');
        lines.push(row);
      });
    }
    
    return lines.join('\n');
  }
  
  private escapeCSV(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }
  
  private convertToXML(data: any): string {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<export>'];
    
    // Network Objects
    if (data.networkObjects && data.networkObjects.length > 0) {
      lines.push('  <networkObjects>');
      data.networkObjects.forEach((obj: any) => {
        lines.push('    <networkObject>');
        lines.push(`      <name><![CDATA[${obj.name || ''}]]></name>`);
        lines.push(`      <type>${obj.type || ''}</type>`);
        lines.push(`      <value><![CDATA[${obj.value || ''}]]></value>`);
        lines.push(`      <description><![CDATA[${obj.description || ''}]]></description>`);
        lines.push('    </networkObject>');
      });
      lines.push('  </networkObjects>');
    }
    
    // Service Objects
    if (data.serviceObjects && data.serviceObjects.length > 0) {
      lines.push('  <serviceObjects>');
      data.serviceObjects.forEach((obj: any) => {
        lines.push('    <serviceObject>');
        lines.push(`      <name><![CDATA[${obj.name || ''}]]></name>`);
        lines.push(`      <protocol>${obj.protocol || ''}</protocol>`);
        lines.push(`      <ports><![CDATA[${obj.ports || ''}]]></ports>`);
        lines.push(`      <description><![CDATA[${obj.description || ''}]]></description>`);
        lines.push('    </serviceObject>');
      });
      lines.push('  </serviceObjects>');
    }
    
    // Access Rules
    if (data.accessRules && data.accessRules.length > 0) {
      lines.push('  <accessRules>');
      data.accessRules.forEach((rule: any) => {
        lines.push('    <accessRule>');
        lines.push(`      <policy><![CDATA[${rule.policy || ''}]]></policy>`);
        lines.push(`      <position>${rule.position || ''}</position>`);
        lines.push(`      <name><![CDATA[${rule.name || ''}]]></name>`);
        lines.push(`      <source><![CDATA[${Array.isArray(rule.source) ? rule.source.join(',') : rule.source || ''}]]></source>`);
        lines.push(`      <destination><![CDATA[${Array.isArray(rule.destination) ? rule.destination.join(',') : rule.destination || ''}]]></destination>`);
        lines.push(`      <services><![CDATA[${Array.isArray(rule.services) ? rule.services.join(',') : rule.services || ''}]]></services>`);
        lines.push(`      <action>${rule.action || ''}</action>`);
        lines.push(`      <disabled>${rule.disabled || false}</disabled>`);
        lines.push(`      <logging><![CDATA[${rule.logging || ''}]]></logging>`);
        lines.push('    </accessRule>');
      });
      lines.push('  </accessRules>');
    }
    
    lines.push('</export>');
    return lines.join('\n');
  }
  
  async export(config: ExportConfig): Promise<ExportResult> {
    const startTime = Date.now();
    const logs: ExportLog[] = [];
    const errors: ExportError[] = [];
    
    logs.push(this.log('info', 'CSM Export started', `Target: ${config.ipAddress}, Format: ${config.format}`));
    
    try {
      // Connect to CSM
      const loginSuccess = await this.retry(
        () => this.client.login({
          ipAddress: config.ipAddress,
          username: config.username,
          password: config.password,
          verifyTls: config.verifyTls
        }),
        config.maxRetries,
        'CSM Login'
      );
      
      if (!loginSuccess) {
        throw new Error('CSM authentication failed');
      }
      
      logs.push(this.log('info', 'CSM authentication successful'));
      
      // Export data
      const exportData: any = {
        metadata: {
          timestamp: new Date().toISOString(),
          source: config.ipAddress,
          format: config.format,
          correlationId: this.correlationId
        }
      };
      
      let totalNetworkObjects = 0;
      let totalServiceObjects = 0;
      let totalAccessRules = 0;
      
      // Export Network Objects
      if (config.networkObjects) {
        logs.push(this.log('info', 'Exporting network objects'));
        const networkObjects = await this.exportNetworkObjects(config, logs);
        exportData.networkObjects = networkObjects;
        totalNetworkObjects = networkObjects.length;
        logs.push(this.log('info', `Network objects exported: ${totalNetworkObjects}`));
      }
      
      // Export Service Objects
      if (config.serviceObjects) {
        logs.push(this.log('info', 'Exporting service objects'));
        const serviceObjects = await this.exportServiceObjects(config, logs);
        exportData.serviceObjects = serviceObjects;
        totalServiceObjects = serviceObjects.length;
        logs.push(this.log('info', `Service objects exported: ${totalServiceObjects}`));
      }
      
      // Export Access Lists
      if (config.accessLists) {
        logs.push(this.log('info', 'Exporting access rules'));
        const accessRules = await this.exportAccessRules(config, logs);
        exportData.accessRules = accessRules;
        totalAccessRules = accessRules.length;
        logs.push(this.log('info', `Access rules exported: ${totalAccessRules}`));
      }
      
      // Data validation and consistency checks
      const consistencyChecks = this.performConsistencyChecks(exportData);
      logs.push(this.log('info', 'Consistency checks completed', JSON.stringify(consistencyChecks)));
      
      // Format and create artifacts
      const formattedData = this.formatData(exportData, config.format);
      const checksum = this.calculateChecksum(formattedData);
      
      const result: ExportResult = {
        success: true,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        networkObjectsCount: totalNetworkObjects,
        serviceObjectsCount: totalServiceObjects,
        accessRulesCount: totalAccessRules,
        artifacts: {
          rawData: JSON.stringify(exportData, null, 2),
          transformedData: formattedData,
          checksum,
          format: config.format
        },
        consistencyChecks,
        errors,
        logs
      };
      
      logs.push(this.log('info', 'CSM Export completed successfully', 
        `Duration: ${result.duration}ms, Objects: ${totalNetworkObjects + totalServiceObjects + totalAccessRules}`));
      
      // Cleanup
      this.client.logout();
      
      return result;
      
    } catch (error: any) {
      const exportError: ExportError = {
        type: this.classifyError(error),
        message: error.message,
        details: error.stack,
        timestamp: new Date(),
        retryable: this.isRetryableError(error)
      };
      
      errors.push(exportError);
      logs.push(this.log('error', 'CSM Export failed', error.message));
      
      return {
        success: false,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        networkObjectsCount: 0,
        serviceObjectsCount: 0,
        accessRulesCount: 0,
        artifacts: {
          rawData: '',
          transformedData: '',
          checksum: '',
          format: config.format
        },
        consistencyChecks: {
          completeness: false,
          references: false,
          encoding: false,
          duplicates: 0,
          errors: [error.message],
          warnings: []
        },
        errors,
        logs
      };
    }
  }
  
  private async exportNetworkObjects(config: ExportConfig, logs: ExportLog[]): Promise<any[]> {
    const allObjects: any[] = [];
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const xmlData = await this.retry(
        () => this.client.getPolicyObjectsList({
          policyObjectType: 'NetworkPolicyObject',
          limit: config.batchSize,
          offset
        }),
        config.maxRetries,
        `Network Objects batch (offset: ${offset})`
      );
      
      const objects = CSMXMLParser.parseNetworkObjects(xmlData);
      allObjects.push(...objects);
      
      hasMore = objects.length === config.batchSize;
      offset += config.batchSize;
      
      if (config.parallel && hasMore) {
        // Add small delay for rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return allObjects;
  }
  
  private async exportServiceObjects(config: ExportConfig, logs: ExportLog[]): Promise<any[]> {
    const allObjects: any[] = [];
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const xmlData = await this.retry(
        () => this.client.getPolicyObjectsList({
          policyObjectType: 'ServicePolicyObject',
          limit: config.batchSize,
          offset
        }),
        config.maxRetries,
        `Service Objects batch (offset: ${offset})`
      );
      
      const objects = CSMXMLParser.parseServiceObjects(xmlData);
      allObjects.push(...objects);
      
      hasMore = objects.length === config.batchSize;
      offset += config.batchSize;
      
      if (config.parallel && hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return allObjects;
  }
  
  private async exportAccessRules(config: ExportConfig, logs: ExportLog[]): Promise<any[]> {
    if (config.aclSource === 'policy') {
      if (config.policyName) {
        const xmlData = await this.retry(
          () => this.client.getPolicyConfigByName(config.policyName!),
          config.maxRetries,
          'Policy configuration by name'
        );
        return CSMXMLParser.parseAccessRules(xmlData);
      } else if (config.deviceGid) {
        const xmlData = await this.retry(
          () => this.client.getPolicyConfigByDeviceGID(config.deviceGid!),
          config.maxRetries,
          'Policy configuration by device GID'
        );
        return CSMXMLParser.parseAccessRules(xmlData);
      }
    } else if (config.aclSource === 'cli' && config.deviceIp && config.cliCommand) {
      const xmlData = await this.retry(
        () => this.client.execDeviceReadOnlyCLICmds({
          deviceIP: config.deviceIp!,
          command: 'show',
          argument: config.cliCommand!.replace('show ', '')
        }),
        config.maxRetries,
        'CLI command execution'
      );
      return CSMXMLParser.parseAccessRules(xmlData);
    }
    
    return [];
  }
  
  private performConsistencyChecks(data: any): ExportResult['consistencyChecks'] {
    const errors: string[] = [];
    const warnings: string[] = [];
    let duplicates = 0;
    
    // Validate network objects
    if (data.networkObjects) {
      const validation = this.validateData(data.networkObjects, 'network');
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      duplicates += validation.warnings.filter(w => w.includes('duplicate')).length;
    }
    
    // Validate service objects
    if (data.serviceObjects) {
      const validation = this.validateData(data.serviceObjects, 'service');
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      duplicates += validation.warnings.filter(w => w.includes('duplicate')).length;
    }
    
    // Check encoding
    const encoding = this.checkEncoding(JSON.stringify(data));
    
    return {
      completeness: errors.length === 0,
      references: true, // TODO: Implement reference checking
      encoding,
      duplicates,
      errors,
      warnings
    };
  }
  
  private checkEncoding(data: string): boolean {
    // Check for common encoding issues
    const problematicChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
    return !problematicChars.test(data);
  }
  
  private classifyError(error: any): ExportError['type'] {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('authentication') || message.includes('login') || message.includes('unauthorized')) {
      return 'authentication';
    }
    if (message.includes('network') || message.includes('connection') || message.includes('fetch')) {
      return 'network';
    }
    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (message.includes('schema') || message.includes('xml') || message.includes('parse')) {
      return 'schema';
    }
    if (message.includes('api') || message.includes('http')) {
      return 'api';
    }
    
    return 'validation';
  }
  
  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    
    // Network and timeout errors are usually retryable
    if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return true;
    }
    
    // Authentication errors are not retryable with same credentials
    if (message.includes('authentication') || message.includes('unauthorized')) {
      return false;
    }
    
    // API rate limiting might be retryable
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return true;
    }
    
    return false;
  }
}