# Hospital Management System - Local Setup Guide

This project is built using React, Vite, Express, and Prisma.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- A PostgreSQL database (e.g., Neon, Supabase, or local)

## Getting Started

Follow these steps to run the project locally after downloading the ZIP:

1. **Extract and Open**:
   Extract the ZIP file and open the folder in VS Code.

2. **Install Dependencies**:
   Open a terminal and run:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   A `.env` file is required for the database connection and secrets.
   - You can copy `.env.example` to `.env`.
   - Ensure `DATABASE_URL` matches your PostgreSQL connection string.
   ```bash
   # Example .env content
   DATABASE_URL=
   JWT_SECRET=
   JWT_REFRESH_SECRET=
   PORT=3000
   NODE_ENV=development
   ```

4. **Setup Database**:
   Run the following commands to initialize your database schema and generate the Prisma Client:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

5. **Start the Application**:
   Run the development server:
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:3000`.

## Scripts

- `npm run dev`: Starts the backend server with Vite middleware for the frontend.
- `npm run build`: Builds the frontend and backend for production.
- `npm start`: Runs the production build.
- `npm run lint`: Checks for TypeScript errors.

## Project Structure

- `server.ts`: Backend Express server and API routes.
- `src/`: Frontend React application.
- `prisma/`: Database schema and migrations.
- `.env`: Secret environment variables (ignored by git).
