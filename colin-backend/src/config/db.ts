import mongoose from 'mongoose';
import * as dns from 'dns';

const connectDB = async () => {
  try {
    // Force known DNS servers as a fallback when the system resolver refuses SRV queries
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('Using DNS servers:', dns.getServers());

    // Workflow histories repeat many titles and field names. Negotiate built-in
    // wire compression so report reads do not transfer those strings verbatim.
    await mongoose.connect(process.env.MONGO_URI!, { compressors: ['zlib'], zlibCompressionLevel: 3 });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

export default connectDB;
