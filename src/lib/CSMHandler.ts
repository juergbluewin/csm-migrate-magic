import { CSMClient, CSMXMLParser } from './csmClient';
import { toast } from '@/hooks/use-toast';

// Enums
export enum FirewallPolicyType {
  UNIFIED = 'DeviceAccessRuleUnifiedFirewallPolicy',
  NON_UNIFIED = 'DeviceAccessRuleFirewallPolicy',
  UNDEFINED = 'UNDEFINED'
}

// Interfaces
export interface Device {
  name: string;
  ip: string;
  gid: string;
  sysObjectID?: string;
  policy_type?: string;
  acls?: any[];
  unified_acls?: any[];
  network_objects?: any[];
  port_objects?: any[];
  service_objects?: any[];
}

interface UniqueDict<T> {
  [key: string]: T;
}

interface SerializableObject {
  name: string;
  gid: string;
  type: string;
  sub_type?: string;
  is_group: boolean;
  value: any;
  description: string;
  refs: any;
  protocol?: string;
}

export class CSMHandler {
  private csmClient: CSMClient;
  private devices: { [key: string]: Device } = {};
  private currentDevice: Device | null = null;
  private gidToNameMapper: UniqueDict<string> = {};
  private gidToObjectMapper: UniqueDict<any> = {};
  private connected = false;

  constructor() {
    this.csmClient = new CSMClient();
  }

  // Properties - Current Device
  get currentGid(): string | null {
    return this.currentDevice?.gid || null;
  }

  get current(): Device | null {
    return this.currentDevice;
  }

  get currentPolicyType(): FirewallPolicyType {
    if (!this.currentDevice || !this.currentDevice.policy_type) {
      return FirewallPolicyType.UNDEFINED;
    }
    
    if (this.currentDevice.policy_type === FirewallPolicyType.NON_UNIFIED) {
      return FirewallPolicyType.NON_UNIFIED;
    } else if (this.currentDevice.policy_type === FirewallPolicyType.UNIFIED) {
      return FirewallPolicyType.UNIFIED;
    }
    
    return FirewallPolicyType.UNDEFINED;
  }

  get currentDeviceAcls(): any[] | null {
    return this.getDeviceObject('acls');
  }

  get currentDeviceUnifiedAcls(): any[] | null {
    return this.getDeviceObject('unified_acls');
  }

  get currentDeviceNetworkObjects(): any[] | null {
    return this.getDeviceObject('network_objects');
  }

  get currentDeviceServiceObjects(): any[] | null {
    return this.getDeviceObject('service_objects');
  }

  get currentDevicePortObjects(): any[] | null {
    return this.getDeviceObject('port_objects');
  }

  // Properties - All Objects
  get allNetworkObjects(): any[] {
    return Object.values(this.gidToObjectMapper).filter(
      obj => obj.type === 'NetworkPolicyObject'
    );
  }

  get allServiceObjects(): any[] {
    return Object.values(this.gidToObjectMapper).filter(
      obj => obj.type === 'ServicePolicyObject'
    );
  }

  get allDevices(): { [key: string]: Device } {
    return this.devices;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // Connection Management
  async connect(ipAddress: string, username: string, password: string, verifyTls = false): Promise<boolean> {
    try {
      console.log('Connecting to CSM API...');
      const success = await this.csmClient.login({ ipAddress, username, password, verifyTls });
      
      if (success) {
        this.connected = true;
        console.log('Successfully connected to CSM API');
        toast({
          title: "Connected",
          description: "Successfully connected to CSM",
        });
      }
      
      return success;
    } catch (error) {
      console.error('Failed to connect to CSM:', error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.csmClient.logout();
      this.connected = false;
      this.devices = {};
      this.currentDevice = null;
      this.gidToNameMapper = {};
      this.gidToObjectMapper = {};
      console.log('Disconnected from CSM');
    } catch (error) {
      console.error('Error during disconnect:', error);
    }
  }

  // Device Management
  async getAllDevices(deviceType: 'NetworkPolicyObject' | 'ServicePolicyObject' = 'NetworkPolicyObject'): Promise<{ [key: string]: Device }> {
    if (!this.connected) {
      throw new Error('Not connected to CSM. Call connect() first.');
    }

    try {
      console.log(`Fetching all devices of type: ${deviceType}...`);
      
      const response = await this.csmClient.getPolicyObjectsList({
        policyObjectType: deviceType,
        limit: 1000,
        offset: 0
      });

      const parsedDevices = CSMXMLParser.parseNetworkObjects(response);
      
      parsedDevices.forEach((device: any) => {
        this.devices[device.name] = {
          name: device.name,
          ip: device.ip || '',
          gid: device.gid,
          sysObjectID: device.sysObjectID
        };
        this.gidToNameMapper[device.gid] = device.name;
      });

      console.log(`Loaded ${Object.keys(this.devices).length} devices`);
      return this.devices;
    } catch (error) {
      console.error('Error fetching devices:', error);
      throw error;
    }
  }

  // Policy Management
  async loadPolicyByDeviceName(deviceName: string): Promise<Device | null> {
    if (!this.connected) {
      throw new Error('Not connected to CSM');
    }

    if (!this.devices[deviceName]) {
      await this.getAllDevices();
    }

    const device = this.devices[deviceName];
    if (!device) {
      console.error(`Device ${deviceName} not found`);
      return null;
    }

    try {
      console.log(`Loading policy for device: ${deviceName}`);
      
      // Detect policy type
      const policyType = await this.getDevicePolicyType(device.gid);
      if (!policyType) {
        console.warn(`No supported policy found for device ${deviceName}`);
        return null;
      }

      device.policy_type = policyType;

      // Load policy configuration
      const policyConfig = await this.csmClient.getPolicyConfigByDeviceGID(device.gid, policyType);
      
      // Parse the configuration
      const networkObjects = CSMXMLParser.parseNetworkObjects(policyConfig);
      const serviceObjects = CSMXMLParser.parseServiceObjects(policyConfig);
      const accessRules = CSMXMLParser.parseAccessRules(policyConfig);

      // Update device with parsed data
      device.network_objects = networkObjects;
      device.service_objects = serviceObjects;
      
      if (policyType === FirewallPolicyType.UNIFIED) {
        device.unified_acls = accessRules;
      } else {
        device.acls = accessRules;
      }

      // Extract GIDs for mapping
      this.extractGids(networkObjects, serviceObjects, accessRules);

      // Set as current device
      this.currentDevice = device;
      
      console.log(`Successfully loaded policy for ${deviceName}`);
      return device;
    } catch (error) {
      console.error(`Error loading policy for ${deviceName}:`, error);
      throw error;
    }
  }

  async loadPolicyForAllDevices(): Promise<void> {
    if (!this.devices || Object.keys(this.devices).length === 0) {
      await this.getAllDevices();
    }

    const deviceNames = Object.keys(this.devices);
    await this.loadPolicyForMultipleDevices(deviceNames);
  }

  async loadPolicyForMultipleDevices(deviceNames: string[]): Promise<void> {
    console.log(`Loading policy for ${deviceNames.length} devices...`);

    for (const deviceName of deviceNames) {
      try {
        await this.loadPolicyByDeviceName(deviceName);
        console.log(`✓ Loaded policy for ${deviceName}`);
      } catch (error) {
        console.error(`✗ Failed to load policy for ${deviceName}:`, error);
      }
    }

    console.log('Finished loading policies for all devices');
  }

  // Object Parsing - Two-Stage Analysis
  analyzeNetworkObjects(networkObjects: any[]): {
    hosts: any[];
    networks: any[];
    groups: any[];
  } {
    const hosts: any[] = [];
    const networks: any[] = [];
    const groups: any[] = [];
    const processedIndices: Set<number> = new Set();

    // RUN 1: Objects as marked by CSM
    networkObjects.forEach((item, index) => {
      if (!item.isGroup && item.subType) {
        if (item.subType === 'NH' || item.subType === 'NR') {
          // NH = Network Host, NR = Network Range
          hosts.push(item);
          processedIndices.add(index);
        } else if (item.subType === 'NN') {
          // NN = Network Network
          networks.push(item);
          processedIndices.add(index);
        }
      } else if (item.isGroup) {
        groups.push(item);
        processedIndices.add(index);
      }
    });

    // RUN 2: Analyze unprocessed objects by their data
    networkObjects.forEach((item, index) => {
      if (processedIndices.has(index)) return;

      const ipData = this.getIpData(item);
      
      if (ipData && ipData.length > 0) {
        if (ipData.length === 1) {
          const data = ipData[0];
          if (data.includes('/')) {
            item.subType = 'NN';
            networks.push(item);
          } else {
            item.subType = 'NH';
            hosts.push(item);
          }
        } else {
          // Multiple IPs = Group
          item.isGroup = true;
          groups.push(item);
        }
      }
    });

    console.log(`Analyzed: ${hosts.length} hosts, ${networks.length} networks, ${groups.length} groups`);
    return { hosts, networks, groups };
  }

  // Serialization with Reference Resolution
  prepareObjectsForSerialization(objects: any[], resolveGids = false): SerializableObject[] {
    const serialized: SerializableObject[] = [];

    objects.forEach((obj) => {
      const comment = obj.comment?.replace(/\n/g, ' ').trim() || '';
      
      const serializedObj: SerializableObject = {
        name: obj.name,
        gid: obj.gid,
        type: obj.type || 'Unknown',
        sub_type: obj.subType,
        is_group: obj.isGroup || false,
        value: null,
        description: comment,
        refs: obj.refs || []
      };

      // Handle Network Objects
      if (serializedObj.type === 'NetworkPolicyObject') {
        serializedObj.value = this.getIpData(obj);
      }

      // Handle Service Objects
      if (serializedObj.type === 'ServicePolicyObject' && !obj.isGroup) {
        if (obj.protocol) {
          serializedObj.protocol = obj.protocol;
          serializedObj.value = obj.port || obj.value;
        }
      }

      // Resolve GIDs to names
      if (obj.isGroup && resolveGids && obj.refs && Array.isArray(obj.refs)) {
        const resolvedRefs = obj.refs.map((gid: string) => 
          this.gidToNameMapper[gid] || gid
        );
        serializedObj.refs = resolvedRefs;
      }

      // Only add objects with valid name and description
      if (obj.name?.trim() && obj.name !== ' ') {
        serialized.push(serializedObj);
      }
    });

    return serialized;
  }

  // Helper Methods
  private getDeviceObject(objectType: keyof Device): any | null {
    if (this.currentDevice && objectType in this.currentDevice) {
      return this.currentDevice[objectType] as any;
    }
    return null;
  }

  private getIpData(netObject: any): string[] {
    // Check for unified vs non-unified data
    const unifiedData = netObject.ipData || [];
    const nonUnifiedData = netObject.ipv4Data || [];
    
    if (nonUnifiedData.length > unifiedData.length) {
      return nonUnifiedData;
    }
    
    return unifiedData;
  }

  private async getDevicePolicyType(gid: string): Promise<string | null> {
    const supportedTypes = [
      FirewallPolicyType.NON_UNIFIED,
      FirewallPolicyType.UNIFIED
    ];

    try {
      // In a real implementation, we would query the CSM API
      // For now, we'll default to UNIFIED
      return FirewallPolicyType.UNIFIED;
    } catch (error) {
      console.error('Error detecting policy type:', error);
      return null;
    }
  }

  private extractGids(...objectLists: any[][]): void {
    objectLists.forEach((list) => {
      if (!Array.isArray(list)) return;
      
      list.forEach((obj) => {
        if (obj?.gid && obj?.name) {
          this.gidToNameMapper[obj.gid] = obj.name;
          this.gidToObjectMapper[obj.gid] = obj;
        }
      });
    });
  }

  // Utility method to get object by GID
  getObjectByGid(gid: string): any | null {
    return this.gidToObjectMapper[gid] || null;
  }

  // Utility method to get name by GID
  getNameByGid(gid: string): string | null {
    return this.gidToNameMapper[gid] || null;
  }

  // Reset handler state
  reset(): void {
    this.devices = {};
    this.currentDevice = null;
    this.gidToNameMapper = {};
    this.gidToObjectMapper = {};
    console.log('CSMHandler reset');
  }
}
