const reportService = require("./report.service");
const serializeBigInt = require("../../utils/bigIntSerializer");
const { toCsv } = require("../../utils/csv");
const { toXlsx } = require("../../utils/xlsx");
const { getLabels } = require("./report.labels");
const vehicleOperationService = require("../vehicleOperation/vehicleOperation.service");

const reportController = {
  bookings: async (req, res) => {
    try {
      const data = await reportService.bookingsReport(
        req.user.organizationId,
        req.query,
      );
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  attendance: async (req, res) => {
    try {
      const data = await reportService.attendanceReport(
        req.user.organizationId,
        req.query,
      );
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  // CSV export aligned to the client's report templates. Headers/labels follow
  // the app language passed as ?lang=en|ja (defaults to en).
  export: async (req, res) => {
    try {
      const type = (req.query.type || "bookings").toLowerCase();
      const fmt = ["xlsx", "excel", "xls"].includes((req.query.format || "").toLowerCase())
        ? "xls"
        : "csv";
      const L = getLabels(req.query.lang);
      let headersOut;
      let dataRows;
      let baseName;

      if (type === "bookings") {
        const report = await reportService.bookingsReport(
          req.user.organizationId,
          req.query,
        );
        const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
        const headers = [
          L.bookingId, L.participantId, L.participantName, L.guardianName,
          L.serviceType, L.bookingDate, L.serviceDate, L.status,
          L.pickup, L.dropoff, L.duration, L.notes, L.approvedBy, L.rejectedReason,
        ];
        headersOut = headers;
        dataRows = report.rows.map((r) => {
          // Prefer the org's own service name (with JA variant) when the
          // booking came from a slot; fall back to the category label.
          const isJa = req.query.lang === "ja";
          const svc = isJa
            ? r.serviceNameJa || r.serviceName || L.serviceTypeValue[r.serviceType] || r.serviceType
            : r.serviceName || L.serviceTypeValue[r.serviceType] || r.serviceType;
          return {
            [L.bookingId]: r.bookingCode,
            [L.participantId]: r.participantCode,
            [L.participantName]: r.participantName,
            [L.guardianName]: r.guardianName,
            [L.serviceType]: svc,
            [L.bookingDate]: fmtDate(r.bookingDate),
            [L.serviceDate]: fmtDate(r.serviceDate),
            [L.status]: L.statusValue[r.status] || r.status,
            [L.pickup]: r.pickup,
            [L.dropoff]: r.dropoff,
            [L.duration]: r.duration,
            [L.notes]: r.notes,
            [L.approvedBy]: r.approvedBy,
            [L.rejectedReason]: r.rejectedReason,
          };
        });
        baseName = "bookings-report";
      } else if (type === "attendance") {
        const report = await reportService.attendanceReport(
          req.user.organizationId,
          req.query,
        );
        // Client template: summary columns + Day 1–31 Status/Hours pairs.
        const headers = [
          L.staffId, L.staffName, L.month, L.year,
          L.forecastDays, L.actualDays, L.forecastHours, L.actualHours,
          L.absentDays, L.varianceDays, L.varianceHours,
        ];
        for (let d = 1; d <= 31; d++) {
          headers.push(L.dayStatus(d), L.dayHours(d));
        }
        headersOut = headers;
        dataRows = report.rows.map((r) => {
          const row = {
            [L.staffId]: r.userCode || "",
            [L.staffName]: r.name,
            [L.month]: L.monthName(r.month, r.monthName),
            [L.year]: r.year,
            [L.forecastDays]: r.forecastDays,
            [L.actualDays]: r.actualDays,
            [L.forecastHours]: r.forecastHours,
            [L.actualHours]: r.actualHours,
            [L.absentDays]: r.absentDays,
            [L.varianceDays]: r.varianceDays,
            [L.varianceHours]: r.varianceHours,
          };
          for (let d = 1; d <= 31; d++) {
            const cell = r.days[d - 1];
            row[L.dayStatus(d)] = cell ? cell.status : "";
            row[L.dayHours(d)] = cell ? cell.hours : "";
          }
          return row;
        });
        baseName = "attendance-report";
      } else if (type === "vehicles") {
        // Same server-side export path as bookings/attendance. This report used
        // to be CSV-only and built in the browser, so it was the one report that
        // couldn't produce Excel and didn't localize its headers.
        const report = await vehicleOperationService.getReport(
          req.user.organizationId,
          req.query,
        );
        headersOut = [
          L.vehicleName, L.vehicleNumber, L.month, L.year,
          L.totalTrips, L.totalKm,
          L.fuelCost, L.maintenanceCost, L.insuranceCost,
          L.totalCost, L.costPerTrip, L.costPerKm,
        ];
        dataRows = report.rows.map((r) => ({
          [L.vehicleName]: r.vehicleName,
          [L.vehicleNumber]: r.vehicleNumber,
          [L.month]: L.monthName(r.month, r.monthName),
          [L.year]: r.year,
          [L.totalTrips]: r.totalTrips,
          [L.totalKm]: r.totalKm,
          [L.fuelCost]: r.fuelCost,
          [L.maintenanceCost]: r.maintenanceCost,
          [L.insuranceCost]: r.insuranceCost,
          [L.totalCost]: r.totalCost,
          [L.costPerTrip]: r.costPerTrip,
          [L.costPerKm]: r.costPerKm,
        }));
        baseName = "vehicle-operations-report";
      } else {
        return res
          .status(400)
          .json({ status: false, message: "Invalid report type" });
      }

      if (fmt === "xls") {
        // Real binary Excel file (.xlsx) — opens natively, zero warnings.
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}.xlsx"`);
        return res.status(200).send(toXlsx(headersOut, dataRows));
      }
      // CSV: prepend a UTF-8 BOM so Excel detects the encoding and renders
      // Japanese correctly instead of mojibake (client feedback #16).
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`);
      return res.status(200).send("﻿" + toCsv(headersOut, dataRows));
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = reportController;
