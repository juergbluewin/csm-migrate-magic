# CSMHandler - Comprehensive Cisco Security Manager Handler

A TypeScript implementation of a comprehensive CSM handler, based on the Python reference implementation with advanced features for device management, policy analysis, and object serialization.

## Key Features

### 1. **Device Management**
- Track multiple devices with GID-to-name mapping
- Current device context for focused operations
- Device capability detection

### 2. **Policy Type Detection**
- Automatically detect Unified vs Non-Unified firewall policies
- `FirewallPolicyType` enum for type-safe policy handling
- Support for both `DeviceAccessRuleFirewallPolicy` and `DeviceAccessRuleUnifiedFirewallPolicy`

### 3. **Advanced Object Parsing**
- **Two-stage analysis** for network objects:
  - **RUN 1**: Process CSM-marked objects (NH, NN, NR subtypes)
  - **RUN 2**: Data-based classification for unmarked objects
- Intelligent detection of hosts, networks, and groups
- Handles CSM API inconsistencies

### 4. **Reference Resolution**
- GID-to-name mapping across all objects
- GID-to-object mapping for quick lookups
- Automatic reference resolution in groups

### 5. **Enhanced Serialization**
- Prepare objects for export with normalized structure
- Optional GID resolution to human-readable names
- Support for network objects, service objects, and groups

## Architecture

```typescript
CSMHandler
├── Connection Management
│   ├── connect()
│   ├── disconnect()
│   └── isConnected
│
├── Device Management
│   ├── getAllDevices()
│   ├── allDevices
│   └── current device properties
│
├── Policy Management
│   ├── loadPolicyByDeviceName()
│   ├── loadPolicyForMultipleDevices()
│   └── loadPolicyForAllDevices()
│
├── Object Analysis
│   ├── analyzeNetworkObjects() (2-stage)
│   ├── getIpData() (unified/non-unified)
│   └── extractGids()
│
├── Serialization
│   └── prepareObjectsForSerialization()
│
└── Utilities
    ├── getObjectByGid()
    ├── getNameByGid()
    └── reset()
```

## Comparison with Original Python Implementation

### ✅ Implemented Features

| Feature | Python | TypeScript | Status |
|---------|--------|------------|--------|
| Device Management | ✓ | ✓ | Complete |
| Policy Type Detection | ✓ | ✓ | Complete |
| Current Device Tracking | ✓ | ✓ | Complete |
| GID Mapping | ✓ | ✓ | Complete |
| Two-Stage Object Analysis | ✓ | ✓ | Complete |
| Reference Resolution | ✓ | ✓ | Complete |
| Object Serialization | ✓ | ✓ | Complete |
| Multiple Device Loading | ✓ | ✓ | Complete |

### 🔄 Differences

1. **Serializer Implementation**
   - Python: Uses separate `NetworkObjectSerializer` class for CSV/Excel export
   - TypeScript: `prepareObjectsForSerialization()` returns normalized objects ready for any export format

2. **UniqueDict**
   - Python: Custom `UniqueDict` class
   - TypeScript: Uses standard TypeScript index signature `{ [key: string]: T }`

3. **Error Handling**
   - Python: Uses `exit()` for fatal errors
   - TypeScript: Throws errors and uses toast notifications for user feedback

4. **XML Parsing**
   - Python: Uses `csmparser` library
   - TypeScript: Uses custom `CSMXMLParser` class

## Usage Patterns

### Basic Connection
```typescript
const handler = new CSMHandler();
await handler.connect('192.168.1.100', 'admin', 'password');
```

### Load and Analyze Device
```typescript
await handler.loadPolicyByDeviceName('ASA-Firewall-01');

// Check policy type
if (handler.currentPolicyType === FirewallPolicyType.UNIFIED) {
  console.log('Unified policy detected');
}

// Analyze objects with 2-stage parsing
const networkObjects = handler.currentDeviceNetworkObjects;
const { hosts, networks, groups } = handler.analyzeNetworkObjects(networkObjects);
```

### Prepare for Export
```typescript
// With GID resolution
const serializedHosts = handler.prepareObjectsForSerialization(hosts, true);

// Without GID resolution
const serializedNetworks = handler.prepareObjectsForSerialization(networks, false);
```

### Access Mapped Data
```typescript
// Get object by GID
const obj = handler.getObjectByGid('12345');

// Get name by GID
const name = handler.getNameByGid('12345');

// Get all network objects across all devices
const allNetworks = handler.allNetworkObjects;
```

## Integration with Existing Code

The `CSMHandler` wraps the existing `CSMClient` class and can be used alongside or replace existing implementations:

```typescript
// Old way (still works)
const client = new CSMClient();
await client.login({ ... });
const response = await client.getPolicyObjectsList({ ... });

// New way (recommended)
const handler = new CSMHandler();
await handler.connect('ip', 'user', 'pass');
await handler.loadPolicyByDeviceName('device');
const analyzed = handler.analyzeNetworkObjects(handler.currentDeviceNetworkObjects);
```

## Properties Reference

### Current Device Properties
- `currentGid` - GID of current device
- `current` - Full current device object
- `currentPolicyType` - Policy type enum
- `currentDeviceAcls` - Non-unified ACLs
- `currentDeviceUnifiedAcls` - Unified ACLs
- `currentDeviceNetworkObjects` - Network objects
- `currentDeviceServiceObjects` - Service objects
- `currentDevicePortObjects` - Port objects

### Global Properties
- `allDevices` - All loaded devices
- `allNetworkObjects` - All network objects across devices
- `allServiceObjects` - All service objects across devices
- `isConnected` - Connection status

## Best Practices

1. **Always check connection status** before operations
2. **Use try-catch blocks** for error handling
3. **Call disconnect()** when done to clean up resources
4. **Use analyzeNetworkObjects()** for accurate object classification
5. **Enable GID resolution** when preparing data for human consumption

## See Also

- [CSMHandler.example.ts](./CSMHandler.example.ts) - Comprehensive usage examples
- [csmClient.ts](./csmClient.ts) - Underlying CSM API client
- [csmExportService.ts](./csmExportService.ts) - Export service integration
