FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app

COPY apps/gateway/pom.xml ./apps/gateway/pom.xml
COPY apps/gateway/src ./apps/gateway/src

RUN mvn -f apps/gateway/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=build /app/apps/gateway/target/gateway-1.0.0.jar /app/gateway.jar

EXPOSE 8080 8081
CMD ["java", "-jar", "/app/gateway.jar"]
