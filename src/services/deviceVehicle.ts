import AsyncStorage from "@react-native-async-storage/async-storage";
import { createDeviceVehicleStore } from "../domain/device-vehicle-store";

export const deviceVehicle = createDeviceVehicleStore(AsyncStorage);
