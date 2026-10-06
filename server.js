const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const pdfToPrinter = require("pdf-to-printer");
const { print, getPrinters } = require("pdf-to-printer");

const os = require("os");
const cors = require("cors");
// import "./print.css";

const app = express();
app.use(cors());
app.options("*", cors());
app.use(bodyParser.json({ limit: "20mb" }));

app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
const { exec } = require("child_process");

app.get("/printers", (req, res) => {
  exec(
    "wmic printer get Name,PrinterStatus,WorkOffline /format:csv",
    (error, stdout) => {
      if (error) {
        console.error("Error fetching printers:", error);
        return res.status(500).json({
          message: "Failed to fetch printers",
          error: error.message,
        });
      }

      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const dataLines = lines.slice(1);
      const printers = dataLines.map((line) => {
        const parts = line.split(",");
        const name = parts[1];
        const statusCode = parseInt(parts[2]);
        const workOffline = parts[3]?.toUpperCase() === "TRUE";
        const isConnected = !workOffline;

        return {
          name,
          statusCode,
          printerStatus: getPrinterStatus(statusCode),
          workOffline,
          connectionStatus: isConnected ? "Connected" : "Not Connected",
          isConnected,
        };
      });

      res.status(200).json({
        message: "Printers fetched successfully",
        printers,
      });
      console.log(printers);
    },
  );
});

function getPrinterStatus(code) {
  switch (code) {
    case 1:
      return "Other";
    case 2:
      return "Unknown";
    case 3:
      return "Ready";
    case 4:
      return "Printing";
    case 5:
      return "Warmup";
    case 7:
      return "Offline";
    default:
      return "Unknown";
  }
}

app.post("/check-connection", (req, res) => {
  const input = req.body.printerName || req.body.printerNames;
  console.log(input, "input");

  if (!input) {
    return res
      .status(400)
      .json({
        message: "Please provide 'printerName' or 'printerNames' (array).",
      });
  }

  const printersToCheck = Array.isArray(input) ? input : [input];

  const command = `powershell -Command "Get-Printer | Select-Object Name, PrinterStatus, WorkOffline, PortName | ConvertTo-Json"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("PowerShell Error:", error);
      return res.status(500).json({ message: "System error", results: [] });
    }

    try {
      const rawData = JSON.parse(stdout);
      const allSystemPrinters = Array.isArray(rawData) ? rawData : [rawData];

      const results = printersToCheck.map((reqName) => {
        const printer = allSystemPrinters.find(
          (p) => p.Name.toLowerCase() === reqName.toLowerCase(),
        );

        if (!printer) {
          return {
            name: reqName,
            status: "Not Found",
            connectionStatus: "Failed",
            message: "Printer not installed",
          };
        }

        const isWorkOffline = printer.WorkOffline === true;
        const isStatusOffline =
          printer.PrinterStatus === "Offline" || printer.PrinterStatus === 7;
        const isError =
          printer.PrinterStatus === "Error" || printer.PrinterStatus === 2;
        const isDisconnected = isWorkOffline || isStatusOffline || isError;

        let displayStatus = printer.PrinterStatus;
        if (!displayStatus || displayStatus === "Unknown") {
          displayStatus = isDisconnected ? "Offline" : "Ready";
        }

        return {
          name: printer.Name,
          status: displayStatus,
          workOffline: isWorkOffline,
          connectionStatus: isDisconnected ? "Failed" : "Connected",
          port: printer.PortName,
        };
      });

      res.status(200).json({
        message: "Connection check complete",
        results: results,
      });
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      res.status(500).json({ message: "Failed to parse printer data" });
    }
  });
});

app.post("/queue", (req, res) => {
  const { printerName } = req.body;
  if (!printerName)
    return res.status(400).json({ message: "printerName is required" });

  const command = `powershell -Command "Get-PrintJob -PrinterName '${printerName}' | Select-Object Id, DocumentName, JobStatus, SubmittedTime, UserName | ConvertTo-Json"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res
        .status(200)
        .json({ message: "Queue is empty or printer unreachable", jobs: [] });
    }

    try {
      if (!stdout.trim())
        return res.status(200).json({ message: "Queue is empty", jobs: [] });

      const rawData = JSON.parse(stdout);
      const jobs = Array.isArray(rawData) ? rawData : [rawData];

      res.status(200).json({
        message: `${jobs.length} jobs pending`,
        jobs: jobs.map((j) => ({
          id: j.Id,
          document: j.DocumentName,
          status: j.JobStatus,
          time: j.SubmittedTime,
        })),
      });
    } catch (e) {
      res.status(500).json({ message: "Error parsing queue data" });
    }
  });
});

app.post("/clear-queue", (req, res) => {
  const { printerName } = req.body;
  if (!printerName)
    return res.status(400).json({ message: "printerName is required" });

  console.log(`Attempting to clear queue for: ${printerName}`);

  const command = `wmic printer where "Name='${printerName}'" call CancelAllJobs`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("WMIC Error:", error);

      const psCommand = `powershell -Command "Get-PrintJob -PrinterName '${printerName}' | Remove-PrintJob"`;

      exec(psCommand, (psErr, psOut) => {
        if (psErr) {
          console.error("PowerShell Error:", psErr);
          return res.status(500).json({
            message:
              "Failed to clear queue. Ensure Node.js is running as Administrator.",
            error: psErr.message,
          });
        }
        return res
          .status(200)
          .json({
            message: `Queue cleared for ${printerName} (via PowerShell)`,
          });
      });
      return;
    }

    if (stdout.includes("ReturnValue = 0;")) {
      return res
        .status(200)
        .json({ message: `Queue cleared for ${printerName} (via WMIC)` });
    } else if (stdout.includes("ReturnValue = 5;")) {
      return res
        .status(403)
        .json({
          message: "Access Denied. Please run the server as Administrator.",
        });
    } else {
      return res
        .status(200)
        .json({
          message: "Command executed (Queue likely empty or Printer not found)",
        });
    }
  });
});

// app.post("/open-drawer", (req, res) => {
//   const { printerName } = req.body;
//   const drawerCommand = Buffer.from([27, 112, 0, 25, 250]);
//   const tempPath = path.join(os.tmpdir(), "drawer_kick.bin");
//   fs.writeFileSync(tempPath, drawerCommand);
//   pdfToPrinter.print(tempPath, { printer: printerName })
//     .then(() => res.json({ message: "Cash drawer command sent" }))
//     .catch(e => res.status(500).json({ error: e.message }));
// });

app.post("/print", async (req, res) => {
  console.log("Request received");

  try {
    const { pdfBase64, imageBase64, printernamefromfrontend, paperWidth } = req.body;

    if (!pdfBase64 && !imageBase64) {
      return res.status(400).json({
        message:
          'Missing "pdfBase64" or "imageBase64" field in the request body.',
      });
    }

    if (!printernamefromfrontend || !Array.isArray(printernamefromfrontend)) {
      return res.status(400).json({
        message:
          'Missing or invalid "printernamefromfrontend". Must be an array of printer names.',
      });
    }

    // Determine target printable width in points (1 inch = 72 pt, 1 inch = 25.4 mm)
    // NOTE: Thermal paper rolls (80mm, 58mm, 100mm) have tiny non-printable physical margins
    // on the sides. To eliminate unwanted white blank space around the receipt and ensure
    // edge-to-edge full-width printing while preventing right-side cropping:
    // - 80mm roll -> We use 216 pt (~76.2 mm). Combined with scale: "shrink", this spans edge-to-edge
    //   across the 72mm thermal head without wasted side borders or cropping.
    // - 58mm roll -> We use 156 pt (~55 mm).
    // - 100mm roll -> We use 274 pt (~96.6 mm).
    let targetWidth = 216; // default 80mm (3") -> 216 pt (~76.2mm edge-to-edge width)
    const widthVal = parseInt(paperWidth);
    if (widthVal === 58) {
      targetWidth = 156; // 58mm (2") -> 156 pt (~55mm edge-to-edge width)
    } else if (widthVal === 100) {
      targetWidth = 274; // 100mm (4") -> 274 pt (~96.6mm edge-to-edge width)
    } else if (widthVal && widthVal !== 80) {
      // For custom roll widths, convert mm to points and subtract a minimal 3mm margin
      const PT_PER_MM = 72 / 25.4;
      targetWidth = Math.max(100, (widthVal - 3) * PT_PER_MM);
    }

    let binaryData;

    if (imageBase64) {
      const imageBytes = Buffer.from(
        imageBase64.replace(/^data:image\/\w+;base64,/, ""),
        "base64",
      );

      const pdfDoc = await PDFDocument.create();
      const isPng = imageBase64.startsWith("data:image/png");
      const embeddedImage = isPng
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);

      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      const scale = targetWidth / imgWidth;
      const scaledHeight = imgHeight * scale;
      const finalHeight = scaledHeight;

      const page = pdfDoc.addPage([targetWidth, finalHeight]);

      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: targetWidth,
        height: scaledHeight,
      });

      const pdfBytes = await pdfDoc.save();
      // Write directly — page is already correctly sized; skip the second resize pass.
      const tempDir = os.tmpdir();
      const tempFilePath = path.resolve(tempDir, `temp_${Date.now()}.pdf`);
      fs.writeFileSync(tempFilePath, Buffer.from(pdfBytes));

      console.log("Sending to printers (image path):", printernamefromfrontend);
      await Promise.all(
        printernamefromfrontend.map((printer) =>
          pdfToPrinter
            .print(tempFilePath, {
              printer,
              // Use scale: "shrink" and orientation: "portrait" (valid options in pdf-to-printer).
              // "shrink" ensures that if a printer driver reports a narrower printable box,
              // SumatraPDF automatically scales it down instead of clipping/cropping on the right.
              scale: "shrink",
              orientation: "portrait",
            })
            .then(() => console.log(`✅ Printed to ${printer}`))
            .catch((err) =>
              console.error(`❌ Failed to print to ${printer}:`, err),
            ),
        ),
      );

      setTimeout(() => {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      }, 10000);

      return res.status(200).json({ message: "PDF printed successfully!" });
    } else {
      const base64Data = pdfBase64.replace(/^data:.*;base64,/, "");
      binaryData = Buffer.from(base64Data, "base64");
    }

    // ── PDF path: scale content proportionally to fit target width ──────────
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(binaryData);
    } catch (err) {
      console.error("PDF load failed:", err);
      return res.status(400).json({
        message: "Invalid PDF format.",
        error: err.message,
      });
    }

    const pages = pdfDoc.getPages();
    pages.forEach((page) => {
      const { width, height } = page.getSize();

      // Treat landscape pages as portrait (swap dims if wider than tall)
      const srcW = width > height ? height : width;
      const srcH = width > height ? width : height;

      if (Math.abs(srcW - targetWidth) < 2) {
        // Already the right width — just ensure portrait orientation
        page.setSize(srcW, srcH);
        return;
      }

      // Scale the entire page content so it fits targetWidth exactly.
      // This moves/scales all drawn content; without this, setSize only
      // resizes the page box and content overflows → gets clipped.
      const scale = targetWidth / srcW;
      const newHeight = srcH * scale;

      page.scaleContent(scale, scale);
      page.setSize(targetWidth, newHeight);
    });

    const updatedPdfBytes = await pdfDoc.save();
    const tempDir = os.tmpdir();
    const tempFilePath = path.resolve(tempDir, `temp_${Date.now()}.pdf`);
    fs.writeFileSync(tempFilePath, updatedPdfBytes);

    console.log("Sending to printers (pdf path):", printernamefromfrontend);

    await Promise.all(
      printernamefromfrontend.map((printer) =>
        pdfToPrinter
          .print(tempFilePath, {
            printer,
            // Use scale: "shrink" and orientation: "portrait" (valid options in pdf-to-printer).
            scale: "shrink",
            orientation: "portrait",
          })
          .then(() => console.log(`✅ Printed to ${printer}`))
          .catch((err) =>
            console.error(`❌ Failed to print to ${printer}:`, err),
          ),
      ),
    );

    setTimeout(() => {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }, 10000);

    res.status(200).json({ message: "PDF printed successfully!" });
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      message: "Printing failed!",
      error: error.message,
    });
  }
});

const PORT = 4100;
function startServer() {
  app.listen(PORT, () => {
    console.log(`🖨️  Printer server running at http://localhost:${PORT}`);
  });
}

module.exports = startServer;
