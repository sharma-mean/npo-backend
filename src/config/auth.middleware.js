const jwt = require("jsonwebtoken");

const prisma = require("../config/db");
const { UserRole } = require("@prisma/client");
const {
  isSubscriptionExpired,
  isRenewable,
} = require("../modules/organizationSubscription/subscription.logic");

const authMiddleware = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).json({
          status: false,

          message: "Authorization token required",
        });
      }

      const token = authHeader.split(" ")[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });

      const user = await prisma.user.findFirst({
        where: {
          id: decoded.userId,

          isDeleted: false,
        },

        include: {
          organization: true,
        },
      });

      if (!user) {
        return res.status(401).json({
          status: false,

          message: "User not found",
        });
      }

      if (!user.status) {
        return res.status(403).json({
          status: false,

          message: "User account suspended",
        });
      }

      if (user.organization && !user.organization.status) {
        return res.status(403).json({
          status: false,

          message: "Organization suspended",
        });
      }

      req.user = {
        id: user.id,

        fullName: user.fullName,

        email: user.email,

        role: user.role,

        organizationId: user.organizationId,

        designationId: user.designationId,

        serviceType: ["NPO_ADMIN", "GUARDIAN"].includes(user.role)
          ? null
          : user.serviceType,
      };

      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        return res.status(403).json({
          status: false,
          message: "You do not have permission to perform this action",
        });
      }

      // Subscription expiry guard — lightweight, read-only (no plan include,
      // no writes). Only blocks non-admin org roles; NPO_ADMIN always passes
      // (so they can reach billing). Actual expiry settling happens lazily in
      // /organization-subscriptions/my and via the daily cron.
      if (
        user.organizationId &&
        user.role !== "SUPER_ADMIN" &&
        user.role !== "NPO_ADMIN"
      ) {
        try {
          const sub = await prisma.organizationSubscription.findFirst({
            where: { organizationId: user.organizationId },
            orderBy: { createdAt: "desc" },
            select: {
              endAt: true,
              status: true,
              autoRenew: true,
              cancelAtPeriodEnd: true,
              isTrial: true,
            },
          });
          const now = Date.now();
          // Block when the shared rule says expired, OR when the period has
          // ended and the sub is NOT renewable but hasn't been settled yet
          // (cron/lazy-settle lag) — closes the up-to-24h access gap.
          const endedNonRenewable =
            sub && Number(sub.endAt) < now && !isRenewable(sub);
          if (isSubscriptionExpired(sub, now) || endedNonRenewable) {
            return res.status(402).json({
              status: false,
              code: "SUBSCRIPTION_EXPIRED",
              message:
                "Your organization's subscription is inactive. Please contact your administrator.",
            });
          }
        } catch (e) {
          console.error("[auth] subscription check failed:", e.message);
          return res.status(503).json({
            status: false,
            message:
              "Unable to verify your organization's subscription right now. Please try again.",
          });
        }
      }

      next();
    } catch (error) {
      // Only genuine token problems are 401. A DB/infra failure (e.g. the
      // Prisma lookup above throwing on a slow/contended connection) is NOT an
      // auth failure — returning 401 here would log the user out on a transient
      // hiccup. Surface those as 503 so the client retries instead of logging out.
      const JWT_ERRORS = new Set([
        "TokenExpiredError",
        "JsonWebTokenError",
        "NotBeforeError",
      ]);

      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          status: false,
          message: "Token expired",
        });
      }

      if (JWT_ERRORS.has(error.name)) {
        return res.status(401).json({
          status: false,
          message: "Invalid token",
        });
      }

      console.error("[auth] unexpected error:", error.message);
      return res.status(503).json({
        status: false,
        message: "Service temporarily unavailable. Please try again.",
      });
    }
  };
};

module.exports = authMiddleware;
