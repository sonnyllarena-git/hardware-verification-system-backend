# backend-hardware-check-api
Node.js/Express backend. Receives hardware data from EXE. Validates specs against TCP compliance requirements (Windows 10+, 4+ CPU cores, 8GB+ RAM, 256GB+ storage, 15 Mbps internet, 720p+ screen, webcam + headset). Stores results in SQL Server database. Returns PASS/FAIL status to EXE. Provides endpoints for dashboard to fetch applicant results.
