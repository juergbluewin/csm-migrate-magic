/**
 * CSMHandler Usage Examples
 * 
 * This comprehensive handler class provides advanced features for managing
 * Cisco Security Manager (CSM) connections, devices, and policies.
 */

import { CSMHandler, FirewallPolicyType } from './CSMHandler';

// Example 1: Basic Connection and Device Loading
export async function example1_BasicConnection() {
  const handler = new CSMHandler();
  
  // Connect to CSM
  const connected = await handler.connect(
    '192.168.1.100',  // CSM IP
    'admin',           // Username
    'password',        // Password
    false              // Verify TLS
  );
  
  if (!connected) {
    console.error('Failed to connect to CSM');
    return;
  }
  
  // Get all devices
  const devices = await handler.getAllDevices();
  console.log(`Found ${Object.keys(devices).length} devices`);
  
  // Disconnect when done
  await handler.disconnect();
}

// Example 2: Loading Policy for a Specific Device
export async function example2_LoadDevicePolicy() {
  const handler = new CSMHandler();
  
  await handler.connect('192.168.1.100', 'admin', 'password');
  
  // Load policy for specific device
  const device = await handler.loadPolicyByDeviceName('ASA-Firewall-01');
  
  if (device) {
    console.log(`Device: ${device.name}`);
    console.log(`Policy Type: ${device.policy_type}`);
    console.log(`Network Objects: ${device.network_objects?.length || 0}`);
    console.log(`Service Objects: ${device.service_objects?.length || 0}`);
  }
  
  await handler.disconnect();
}

// Example 3: Working with Current Device
export async function example3_CurrentDevice() {
  const handler = new CSMHandler();
  
  await handler.connect('192.168.1.100', 'admin', 'password');
  await handler.loadPolicyByDeviceName('ASA-Firewall-01');
  
  // Access current device properties
  console.log('Current Device GID:', handler.currentGid);
  console.log('Policy Type:', handler.currentPolicyType);
  
  // Check policy type
  if (handler.currentPolicyType === FirewallPolicyType.UNIFIED) {
    console.log('Using Unified Firewall Policy');
    const unifiedAcls = handler.currentDeviceUnifiedAcls;
    console.log(`Unified ACLs: ${unifiedAcls?.length || 0}`);
  } else {
    console.log('Using Non-Unified Firewall Policy');
    const acls = handler.currentDeviceAcls;
    console.log(`ACLs: ${acls?.length || 0}`);
  }
  
  await handler.disconnect();
}

// Example 4: Advanced Object Analysis
export async function example4_ObjectAnalysis() {
  const handler = new CSMHandler();
  
  await handler.connect('192.168.1.100', 'admin', 'password');
  await handler.loadPolicyByDeviceName('ASA-Firewall-01');
  
  const networkObjects = handler.currentDeviceNetworkObjects;
  
  if (networkObjects) {
    // Two-stage analysis: CSM-marked objects + data-based classification
    const analyzed = handler.analyzeNetworkObjects(networkObjects);
    
    console.log(`Hosts: ${analyzed.hosts.length}`);
    console.log(`Networks: ${analyzed.networks.length}`);
    console.log(`Groups: ${analyzed.groups.length}`);
    
    // Prepare for serialization with GID resolution
    const hostsForExport = handler.prepareObjectsForSerialization(
      analyzed.hosts,
      true  // Resolve GIDs to names
    );
    
    console.log('Sample host:', hostsForExport[0]);
  }
  
  await handler.disconnect();
}

// Example 5: Loading Multiple Devices
export async function example5_MultipleDevices() {
  const handler = new CSMHandler();
  
  await handler.connect('192.168.1.100', 'admin', 'password');
  
  // Load specific devices
  await handler.loadPolicyForMultipleDevices([
    'ASA-Firewall-01',
    'ASA-Firewall-02',
    'ASA-Datacenter'
  ]);
  
  // Access all network objects across all loaded devices
  const allNetworkObjects = handler.allNetworkObjects;
  const allServiceObjects = handler.allServiceObjects;
  
  console.log(`Total Network Objects: ${allNetworkObjects.length}`);
  console.log(`Total Service Objects: ${allServiceObjects.length}`);
  
  await handler.disconnect();
}

// Example 6: GID Mapping and Reference Resolution
export async function example6_GidMapping() {
  const handler = new CSMHandler();
  
  await handler.connect('192.168.1.100', 'admin', 'password');
  await handler.loadPolicyByDeviceName('ASA-Firewall-01');
  
  // Get object by GID
  const obj = handler.getObjectByGid('12345');
  if (obj) {
    console.log(`Object Name: ${obj.name}`);
  }
  
  // Get name by GID
  const name = handler.getNameByGid('12345');
  console.log(`Name for GID 12345: ${name}`);
  
  await handler.disconnect();
}

// Example 7: React Component Integration
export function ReactComponentExample() {
  // In a React component:
  /*
  const [handler] = useState(() => new CSMHandler());
  const [devices, setDevices] = useState<{ [key: string]: Device }>({});
  const [loading, setLoading] = useState(false);
  
  const handleConnect = async () => {
    setLoading(true);
    try {
      await handler.connect(ipAddress, username, password);
      const loadedDevices = await handler.getAllDevices();
      setDevices(loadedDevices);
    } catch (error) {
      console.error('Connection failed:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleLoadPolicy = async (deviceName: string) => {
    setLoading(true);
    try {
      await handler.loadPolicyByDeviceName(deviceName);
      
      // Now access current device data
      const networkObjs = handler.currentDeviceNetworkObjects;
      const serviceObjs = handler.currentDeviceServiceObjects;
      
      // Update UI with loaded data
    } catch (error) {
      console.error('Failed to load policy:', error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    return () => {
      handler.disconnect();
    };
  }, [handler]);
  */
}

// Example 8: Error Handling
export async function example8_ErrorHandling() {
  const handler = new CSMHandler();
  
  try {
    // Check connection status before operations
    if (!handler.isConnected) {
      await handler.connect('192.168.1.100', 'admin', 'password');
    }
    
    // Attempt to load policy
    const device = await handler.loadPolicyByDeviceName('NonExistentDevice');
    
    if (!device) {
      console.log('Device not found or has no supported policy');
    }
    
  } catch (error) {
    console.error('Error:', error);
    
    // Reset handler state on error
    handler.reset();
  } finally {
    // Always disconnect
    await handler.disconnect();
  }
}

// Example 9: Complete Workflow
export async function example9_CompleteWorkflow() {
  const handler = new CSMHandler();
  
  try {
    // Step 1: Connect
    console.log('Step 1: Connecting to CSM...');
    await handler.connect('192.168.1.100', 'admin', 'password');
    
    // Step 2: Get all devices
    console.log('Step 2: Loading all devices...');
    const devices = await handler.getAllDevices();
    console.log(`Found ${Object.keys(devices).length} devices`);
    
    // Step 3: Load policy for first device
    const firstDevice = Object.keys(devices)[0];
    console.log(`Step 3: Loading policy for ${firstDevice}...`);
    await handler.loadPolicyByDeviceName(firstDevice);
    
    // Step 4: Analyze objects
    console.log('Step 4: Analyzing network objects...');
    const networkObjects = handler.currentDeviceNetworkObjects;
    if (networkObjects) {
      const { hosts, networks, groups } = handler.analyzeNetworkObjects(networkObjects);
      
      console.log(`  - Hosts: ${hosts.length}`);
      console.log(`  - Networks: ${networks.length}`);
      console.log(`  - Groups: ${groups.length}`);
      
      // Step 5: Prepare for export with reference resolution
      console.log('Step 5: Preparing objects for export...');
      const serializedHosts = handler.prepareObjectsForSerialization(hosts, true);
      const serializedNetworks = handler.prepareObjectsForSerialization(networks, true);
      const serializedGroups = handler.prepareObjectsForSerialization(groups, true);
      
      console.log(`  - Serialized ${serializedHosts.length} hosts`);
      console.log(`  - Serialized ${serializedNetworks.length} networks`);
      console.log(`  - Serialized ${serializedGroups.length} groups`);
      
      // Now you can export these to JSON, CSV, etc.
      return {
        hosts: serializedHosts,
        networks: serializedNetworks,
        groups: serializedGroups
      };
    }
    
  } catch (error) {
    console.error('Workflow failed:', error);
    throw error;
  } finally {
    // Step 6: Cleanup
    console.log('Step 6: Disconnecting...');
    await handler.disconnect();
  }
}
