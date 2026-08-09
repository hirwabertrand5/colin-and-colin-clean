import mongoose from 'mongoose';
import * as dns from 'dns';

const connectDB = async () => {
  try {
    // Force known DNS servers as a fallback when the system resolver refuses SRV queries
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('Using DNS servers:', dns.getServers());

    await mongoose.connect(process.env.MONGO_URI!);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

export default connectDB;